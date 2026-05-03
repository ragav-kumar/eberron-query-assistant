import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadDefaultConfig } from "../config/index.js";
import { formatThrownValue, hasErrorCode } from "../errors.js";
import { createFilesystemIngestionService, createSqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import { createOpenAiChatAdapter, createOpenAiEmbeddingAdapter, type ChatAdapter } from "../provider/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import { createSqliteRetrievalService, type RetrievalService } from "../retrieval/index.js";
import { createAssistantSession, type AssistantSession, type AssistantSessionLogExchange } from "../runtime/assistant-session.js";
import {
  createNpcGenerationSession,
  type GeneratedNpc,
  type NpcGenerationSession
} from "../runtime/npc-session.js";
import { createSqlitePartyContextService, type PartyContextService } from "../runtime/party-context.js";
import { runStartupRefresh } from "../runtime/refresh.js";
import {
  createSessionLog,
  listSessionLogFiles,
  readSessionLogFile,
  type SessionLog,
  type SessionLogExchange,
  type SessionLogFile
} from "../runtime/session-log.js";
import { createFilesystemSourceDiscoveryService, type SourceDiscoveryService } from "../source-discovery/index.js";
import { createFilesystemStateStore, type StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface WebApp {
  askAssistant(prompt: string, sessionId?: string): Promise<WebOperationResult>;
  generateNpcs(prompt: string, sessionId?: string): Promise<WebOperationResult>;
  getContext(): Promise<string>;
  getLog(options?: string | { filePath?: string; sessionId?: string }): Promise<WebLogResponse>;
  getNpcs(): Promise<WebNpcResponse>;
  getStatus(options?: { sessionId?: string }): Promise<WebStatusResponse>;
  refresh(forceReingest: boolean): Promise<WebOperationResult>;
  subscribeConsole(listener: WebConsoleListener): () => void;
  writeContext(markdown: string): Promise<void>;
}

export interface WebAppDependencies {
  assistant?: AssistantSession;
  chat?: ChatAdapter;
  config?: RuntimeConfig;
  discovery?: SourceDiscoveryService;
  ingestion?: IngestionService;
  log?: SessionLog;
  npcSession?: NpcGenerationSession;
  partyContext?: PartyContextService;
  retrieval?: RetrievalService;
  stateStore?: StateStore;
}

export interface WebLogResponse {
  activeFilePath: string | null;
  exchanges: SessionLogExchange[];
  files: SessionLogFile[];
  filePath: string | null;
  readOnly: boolean;
}

export type WebConsoleLevel = "debug" | "error" | "info" | "warn";

export interface WebConsoleEntry {
  id: string;
  level: WebConsoleLevel;
  message: string;
  timestamp: string;
}

export interface WebConsoleResponse {
  entries: WebConsoleEntry[];
}

export type WebConsoleListener = (entry: WebConsoleEntry) => void;

export interface WebOperationResult {
  console: WebConsoleResponse;
  log: WebLogResponse;
  npcs: WebNpcResponse;
  ok: true;
  summary?: StartupRefreshSummary;
}

export interface WebNpcResponse {
  npcs: GeneratedNpc[];
}

export interface WebStatusResponse {
  activeOperation: string | null;
  console: WebConsoleResponse;
  log: WebLogResponse;
  npcs: WebNpcResponse;
}

const DEFAULT_SESSION_ID = "default";

interface StandardSessionState {
  assistant: AssistantSession | null;
  log: SessionLog | null;
}

interface NpcSessionState {
  npcSession: NpcGenerationSession | null;
}

export const createWebApp = (dependencies: WebAppDependencies = {}): WebApp => {
  const config = dependencies.config ?? loadDefaultConfig();
  let hasRoutineRefresh = false;
  const consoleFeed = createMemoryConsoleFeed();
  const standardSessions = new Map<string, StandardSessionState>();
  const npcSessions = new Map<string, NpcSessionState>();

  if (dependencies.log || dependencies.assistant) {
    standardSessions.set(DEFAULT_SESSION_ID, {
      assistant: dependencies.assistant ?? null,
      log: dependencies.log ?? null
    });
  }

  if (dependencies.npcSession) {
    npcSessions.set(DEFAULT_SESSION_ID, {
      npcSession: dependencies.npcSession
    });
  }

  const readStandardSession = (sessionId: string): StandardSessionState => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    let session = standardSessions.get(normalizedSessionId);
    if (!session) {
      session = {
        assistant: null,
        log: null
      };
      standardSessions.set(normalizedSessionId, session);
    }
    return session;
  };

  const readNpcSession = (sessionId: string): NpcSessionState => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    let session = npcSessions.get(normalizedSessionId);
    if (!session) {
      session = {
        npcSession: null
      };
      npcSessions.set(normalizedSessionId, session);
    }
    return session;
  };

  const ensureLog = async (session: StandardSessionState, title: string): Promise<SessionLog> => {
    session.log ??= await createSessionLog({
      logDir: config.logDir,
      title
    });
    return session.log;
  };
  let activeOperation: string | null = null;
  const defaultReporter = createQueuedConsoleProgressReporter(consoleFeed);
  const partyContext = dependencies.partyContext ?? createSqlitePartyContextService();
  const retrieval =
    dependencies.retrieval ??
    createSqliteRetrievalService({
      embeddingAdapter: createOpenAiEmbeddingAdapter(config.provider),
      reporter: defaultReporter
    });
  const appendStandardSessionExchange = async (
    session: StandardSessionState,
    exchange: AssistantSessionLogExchange
  ): Promise<void> => {
    const log = await ensureLog(session, exchange.sessionTitle);
    await log.append({
      assistant: exchange.assistant,
      title: exchange.title,
      user: exchange.user
    });
  };
  const ensureAssistant = (session: StandardSessionState): AssistantSession => {
    session.assistant ??= createAssistantSession({
      assistant: config.assistant,
      appendExchange: async (exchange) => {
        await appendStandardSessionExchange(session, exchange);
      },
      chat: dependencies.chat ?? createOpenAiChatAdapter(config.provider),
      config,
      partyContext,
      retrieval
    });
    return session.assistant;
  };
  const ensureNpcSession = (session: NpcSessionState): NpcGenerationSession => {
    session.npcSession ??= createNpcGenerationSession({
      assistant: config.assistant,
      chat: dependencies.chat ?? createOpenAiChatAdapter(config.provider),
      config,
      retrieval
    });
    return session.npcSession;
  };

  const readNpcs = async (sessionId = DEFAULT_SESSION_ID): Promise<WebNpcResponse> => ({
    npcs: await (readNpcSession(sessionId).npcSession ?? ensureNpcSession(readNpcSession(sessionId))).read()
  });

  const readLog = async (options: string | { filePath?: string; sessionId?: string } = {}): Promise<WebLogResponse> => {
    const normalizedOptions = typeof options === "string" ? { filePath: options } : options;
    const sessionId = normalizedOptions.sessionId ?? DEFAULT_SESSION_ID;
    const activeFilePath = readStandardSession(sessionId).log?.filePath ?? null;
    const filePath = normalizedOptions.filePath !== undefined
      ? normalizedOptions.filePath.trim().length > 0
        ? normalizedOptions.filePath
        : null
      : activeFilePath;
    const files = await listSessionLogFiles(config.logDir, activeFilePath);

    if (!filePath) {
      return {
        activeFilePath,
        exchanges: [],
        files,
        filePath: null,
        readOnly: false
      };
    }

    return {
      activeFilePath,
      exchanges: await readSessionLogFile(config.logDir, filePath),
      files,
      filePath,
      readOnly: activeFilePath === null || path.resolve(filePath) !== path.resolve(activeFilePath)
    };
  };

  const runExclusive = async <T>(operation: string, task: () => Promise<T>): Promise<T> => {
    if (activeOperation !== null) {
      throw createBusyError(activeOperation);
    }

    activeOperation = operation;
    try {
      return await task();
    } finally {
      activeOperation = null;
    }
  };

  const runRefreshTask = async (forceReingest: boolean): Promise<StartupRefreshSummary> => {
    const reporter = createQueuedConsoleProgressReporter(consoleFeed);
    const options: RuntimeOptions = {
      forceReingest,
      retrievalQuery: null
    };
    const summary = await runStartupRefresh(config, options, {
      discovery: dependencies.discovery ?? createFilesystemSourceDiscoveryService(),
      ingestion:
        dependencies.ingestion ??
        createFilesystemIngestionService({
          corpusStore: createSqliteCorpusStore(),
          reporter
        }),
      reporter,
      retrieval,
      stateStore: dependencies.stateStore ?? createFilesystemStateStore()
    });
    await reporter.flush();
    hasRoutineRefresh = true;
    consoleFeed.info(formatRefreshSummaryMessage(summary));
    return summary;
  };

  const ensureRoutineRefresh = async (): Promise<void> => {
    if (hasRoutineRefresh) {
      return;
    }
    consoleFeed.info("No completed refresh found for this server session; running routine refresh before continuing.");
    await runRefreshTask(false);
  };

  return {
    async askAssistant(prompt, sessionId = DEFAULT_SESSION_ID) {
      return runExclusive("assistant", async () => {
        const standardSession = readStandardSession(sessionId);
        try {
          await ensureRoutineRefresh();
          await ensureAssistant(standardSession).ask(prompt);
        } catch (error) {
          const message = formatThrownValue(error);
          consoleFeed.error(`Assistant response failed: ${message}`);
          throw createWebOperationError(message, consoleFeed.read());
        }
        return {
          ok: true,
          console: consoleFeed.read(),
          log: await readLog({ sessionId }),
          npcs: await readNpcs()
        };
      });
    },
    async generateNpcs(prompt, sessionId = DEFAULT_SESSION_ID) {
      return runExclusive("npcs", async () => {
        const npcSessionState = readNpcSession(sessionId);
        try {
          await ensureRoutineRefresh();
          await ensureNpcSession(npcSessionState).generate(prompt);
        } catch (error) {
          const message = formatThrownValue(error);
          consoleFeed.error(`NPC generation failed: ${message}`);
          throw createWebOperationError(message, consoleFeed.read());
        }
        return {
          ok: true,
          console: consoleFeed.read(),
          log: emptyLogResponse(await listSessionLogFiles(config.logDir, null)),
          npcs: await readNpcs(sessionId)
        };
      });
    },
    async getContext() {
      await ensureAdditionalContextFile(config);
      return readFile(config.assistant.additionalContextPath, "utf8");
    },
    getLog: readLog,
    getNpcs() {
      return readNpcs();
    },
    async getStatus(options = {}) {
      return {
        activeOperation,
        console: consoleFeed.read(),
        log: await readLog({ sessionId: options.sessionId ?? DEFAULT_SESSION_ID }),
        npcs: await readNpcs()
      };
    },
    async refresh(forceReingest) {
      return runExclusive(forceReingest ? "force-reingest" : "refresh", async () => {
        const summary = await runRefreshTask(forceReingest);
        return {
          ok: true,
          console: consoleFeed.read(),
          summary,
          log: emptyLogResponse(await listSessionLogFiles(config.logDir, null)),
          npcs: await readNpcs()
        };
      });
    },
    subscribeConsole(listener) {
      return consoleFeed.subscribe(listener);
    },
    async writeContext(markdown) {
      await ensureAdditionalContextFile(config);
      await writeFile(config.assistant.additionalContextPath, markdown, "utf8");
    }
  };
};

export interface BusyError {
  kind: "busy";
  message: string;
  operation: string;
}

export interface WebOperationError {
  console: WebConsoleResponse;
  kind: "web-operation";
  message: string;
}

export const isBusyError = (error: unknown): error is BusyError => {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    error.kind === "busy" &&
    "operation" in error &&
    typeof error.operation === "string"
  );
};

const createBusyError = (operation: string): BusyError => ({
  kind: "busy",
  message: `Another operation is already running: ${operation}.`,
  operation
});

export const isWebOperationError = (error: unknown): error is WebOperationError => {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    error.kind === "web-operation" &&
    "console" in error &&
    typeof error.console === "object"
  );
};

const createWebOperationError = (message: string, console: WebConsoleResponse): WebOperationError => ({
  console,
  kind: "web-operation",
  message
});

const normalizeSessionId = (sessionId: string): string => {
  const normalized = sessionId.trim();
  return normalized.length > 0 ? normalized : DEFAULT_SESSION_ID;
};

const emptyLogResponse = (files: SessionLogFile[]): WebLogResponse => ({
  activeFilePath: null,
  exchanges: [],
  files,
  filePath: null,
  readOnly: false
});

const ensureAdditionalContextFile = async (config: RuntimeConfig): Promise<void> => {
  await mkdir(config.assistant.assistantDir, { recursive: true });
  try {
    await readFile(config.assistant.additionalContextPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      await writeFile(config.assistant.additionalContextPath, "", "utf8");
      return;
    }
    throw error;
  }
};

interface QueuedConsoleProgressReporter extends ProgressReporter {
  flush(): Promise<void>;
}

interface MemoryConsoleFeed {
  debug(message: string): void;
  error(message: string): void;
  info(message: string): void;
  read(): WebConsoleResponse;
  subscribe(listener: WebConsoleListener): () => void;
  warn(message: string): void;
}

const createMemoryConsoleFeed = (): MemoryConsoleFeed => {
  const entries: WebConsoleEntry[] = [];
  const listeners = new Set<WebConsoleListener>();
  let nextId = 1;

  const append = (level: WebConsoleLevel, message: string): void => {
    const entry = {
      id: String(nextId),
      level,
      message,
      timestamp: new Date().toISOString()
    };
    entries.push(entry);
    nextId += 1;
    for (const listener of listeners) {
      listener({ ...entry });
    }
  };

  return {
    debug(message) {
      append("debug", message);
    },
    error(message) {
      append("error", message);
    },
    info(message) {
      append("info", message);
    },
    read() {
      return {
        entries: entries.map((entry) => ({ ...entry }))
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      for (const entry of entries) {
        listener({ ...entry });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    warn(message) {
      append("warn", message);
    }
  };
};

const createQueuedConsoleProgressReporter = (consoleFeed: MemoryConsoleFeed): QueuedConsoleProgressReporter => {
  let queue = Promise.resolve();
  const append = (level: WebConsoleLevel, message: string): void => {
    queue = queue.then(() => {
      consoleFeed[level](message);
    });
  };

  return {
    async flush() {
      await queue;
    },
    info(message) {
      append("info", message);
    },
    progress(message) {
      append("info", message);
    },
    warn(message) {
      append("warn", message);
    }
  };
};

const formatRefreshSummaryMessage = (summary: StartupRefreshSummary): string => {
  const retrieval = summary.retrieval
    ? ` Retrieval chunks=${summary.retrieval.chunkCount}, reused=${summary.retrieval.reusedEmbeddings}, regenerated=${summary.retrieval.regeneratedEmbeddings}.`
    : "";
  const degraded = summary.degraded ? ` Degraded sources: ${summary.degradedSources.join(", ")}.` : "";
  return `Refresh complete. Force reingest: ${String(summary.forceReingest)}.${retrieval}${degraded}`;
};

export const toPublicPath = (filePath: string): string => {
  return path.normalize(filePath);
};
