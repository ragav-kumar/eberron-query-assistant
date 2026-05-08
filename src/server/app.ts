import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadDefaultConfig } from "../config/index.js";
import { formatThrownValue, hasErrorCode, isOperationAbortedError } from "../errors.js";
import { createFilesystemIngestionService, createSqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import {
  createOpenAiChatAdapter,
  createOpenAiEmbeddingAdapter,
  type ChatAdapter,
  type ChatCompletionDiagnostic
} from "../provider/index.js";
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
  type SessionLogEntry,
  type SessionLog,
  type SessionLogFile
} from "../runtime/session-log.js";
import { createFilesystemSourceDiscoveryService, type SourceDiscoveryService } from "../source-discovery/index.js";
import { createFilesystemStateStore, type StateStore } from "../state/index.js";
import { createJsonlTimingReporter, type TimingContext, type TimingReporter } from "../timing.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface WebApp {
  askAssistant(
    prompt: string,
    sessionId?: string,
    includePartyContext?: boolean,
    retrievalTurnLimit?: number
  ): Promise<WebOperationResult>;
  generateNpcs(prompt: string, sessionId?: string, includePartyContext?: boolean): Promise<WebOperationResult>;
  getContext(): Promise<string>;
  getLog(options?: string | { filePath?: string; sessionId?: string }): Promise<WebLogResponse>;
  getNpcs(): Promise<WebNpcResponse>;
  getStatus(options?: { sessionId?: string }): Promise<WebStatusResponse>;
  refresh(forceReingest: boolean): Promise<WebOperationResult>;
  startStartupRefresh(): void;
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
  timing?: TimingReporter;
}

export interface WebLogResponse {
  activeFilePath: string | null;
  exchanges: SessionLogEntry[];
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
  providerDebug?: ChatCompletionDiagnostic[];
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
const MAX_CONSOLE_ENTRIES = 2_000;

interface StandardSessionState {
  assistant: AssistantSession | null;
  log: SessionLog | null;
  logNeedsSessionTitle: boolean;
}

interface NpcSessionState {
  npcSession: NpcGenerationSession | null;
}

interface ActiveOperation {
  abortController: AbortController;
  done: Promise<void>;
  id: string;
  name: string;
}

export const createWebApp = (dependencies: WebAppDependencies = {}): WebApp => {
  const config = dependencies.config ?? loadDefaultConfig();
  let hasRoutineRefresh = false;
  let nextOperationId = 1;
  const consoleFeed = createMemoryConsoleFeed();
  const timingReporter = dependencies.timing ?? createJsonlTimingReporter({ repoRoot: config.repoRoot });
  const standardSessions = new Map<string, StandardSessionState>();
  const npcSessions = new Map<string, NpcSessionState>();

  if (dependencies.log || dependencies.assistant) {
    standardSessions.set(DEFAULT_SESSION_ID, {
      assistant: dependencies.assistant ?? null,
      log: dependencies.log ?? null,
      logNeedsSessionTitle: false
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
        log: null,
        logNeedsSessionTitle: false
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
  let activeOperation: ActiveOperation | null = null;
  const defaultReporter = createQueuedConsoleProgressReporter(consoleFeed);
  const partyContext = createCachedPartyContextService(dependencies.partyContext ?? createSqlitePartyContextService());
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
    if (session.logNeedsSessionTitle) {
      await log.rename(exchange.sessionTitle);
      session.logNeedsSessionTitle = false;
    }
    await log.append({
      assistant: exchange.assistant,
      kind: "exchange",
      title: exchange.title,
      user: exchange.user
    });
  };
  const ensureAssistant = (session: StandardSessionState): AssistantSession => {
    session.assistant ??= createAssistantSession({
      assistant: config.assistant,
      appendProgress: async (entry) => {
        const shouldCreateProvisionalLog = session.log === null;
        const log = await ensureLog(session, "Retrieval Session");
        if (shouldCreateProvisionalLog) {
          session.logNeedsSessionTitle = true;
        }
        await log.append(entry);
      },
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
      partyContext,
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

  const runExclusive = async <T>(
    operation: string,
    task: (timing: TimingContext, abortSignal: AbortSignal) => Promise<T>,
    options: { cancelStartupRefresh?: boolean } = {}
  ): Promise<T> => {
    if (activeOperation !== null) {
      if (options.cancelStartupRefresh && activeOperation.name === "startup-refresh") {
        const canceledOperation = activeOperation;
        consoleFeed.warn("Canceling startup refresh before force reingest.");
        canceledOperation.abortController.abort();
        await canceledOperation.done;
      } else {
        throw createBusyError(activeOperation.name);
      }
    }

    const abortController = new AbortController();
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const operationId = `${new Date().toISOString()}-${operation}-${nextOperationId}`;
    activeOperation = {
      abortController,
      done,
      id: operationId,
      name: operation
    };
    const timing = {
      operation,
      operationId,
      reporter: timingReporter
    };
    nextOperationId += 1;
    try {
      return await timingReporter.time(timing, "web.operation", () => task(timing, abortController.signal));
    } finally {
      if (activeOperation?.id === operationId) {
        activeOperation = null;
      }
      resolveDone();
    }
  };

  const startStartupRefresh = (): void => {
    if (hasRoutineRefresh || activeOperation !== null) {
      return;
    }

    void runExclusive("startup-refresh", async (timing, abortSignal) => {
      try {
        await timing.reporter.time(timing, "web.startup_refresh.run", () => runRefreshTask(false, abortSignal));
      } catch (error) {
        if (isOperationAbortedError(error)) {
          consoleFeed.warn("Startup refresh canceled.");
          return;
        }
        const message = formatThrownValue(error);
        consoleFeed.error(`Startup refresh failed: ${message}`);
        throw error;
      }
    }).catch(() => undefined);
  };

  const runRefreshTask = async (forceReingest: boolean, abortSignal?: AbortSignal): Promise<StartupRefreshSummary> => {
    const reporter = createQueuedConsoleProgressReporter(consoleFeed);
    const stateStore = dependencies.stateStore ?? createFilesystemStateStore();
    const options: RuntimeOptions = {
      abortSignal,
      forceReingest
    };
    const summary = await runStartupRefresh(config, options, {
      discovery: dependencies.discovery ?? createFilesystemSourceDiscoveryService(),
      ingestion:
        dependencies.ingestion ??
        createFilesystemIngestionService({
          corpusStore: createSqliteCorpusStore(),
          reporter,
          stateStore
        }),
      reporter,
      retrieval,
      stateStore
    });
    await reporter.flush();
    hasRoutineRefresh = true;
    partyContext.clear();
    consoleFeed.info(formatRefreshSummaryMessage(summary));
    return summary;
  };

  const ensureRoutineRefresh = async (timing?: TimingContext): Promise<void> => {
    if (hasRoutineRefresh) {
      return;
    }
    consoleFeed.info("No completed refresh found for this server session; running routine refresh before continuing.");
    if (timing) {
        await timing.reporter.time(timing, "web.refresh.ensure", () => runRefreshTask(false));
      return;
    }
    await runRefreshTask(false);
  };

  return {
    async askAssistant(prompt, sessionId = DEFAULT_SESSION_ID, includePartyContext = true, retrievalTurnLimit = 1) {
      return runExclusive("assistant", async (timing) => {
        const standardSession = readStandardSession(sessionId);
        const providerDebug = createProviderDebugCollector(config);
        try {
          await ensureRoutineRefresh(timing);
          await timing.reporter.time(timing, "web.assistant.ask", () =>
            ensureAssistant(standardSession).ask(prompt, {
              includePartyContext,
              onProviderDiagnostic: providerDebug.collect,
              retrievalTurnLimit,
              timing
            })
          );
        } catch (error) {
          const message = formatThrownValue(error);
          consoleFeed.error(`Assistant response failed: ${message}`);
          throw createWebOperationError(message, consoleFeed.read(), providerDebug.entries);
        }
        return {
          ok: true,
          console: consoleFeed.read(),
          log: await readLog({ sessionId }),
          npcs: await readNpcs(),
          providerDebug: providerDebug.entries
        };
      });
    },
    async generateNpcs(prompt, sessionId = DEFAULT_SESSION_ID, includePartyContext = true) {
      return runExclusive("npcs", async (timing) => {
        const npcSessionState = readNpcSession(sessionId);
        const providerDebug = createProviderDebugCollector(config);
        try {
          await ensureRoutineRefresh(timing);
          await timing.reporter.time(timing, "web.npcs.generate", () =>
            ensureNpcSession(npcSessionState).generate(prompt, {
              includePartyContext,
              onProviderDiagnostic: providerDebug.collect,
              timing
            })
          );
        } catch (error) {
          const message = formatThrownValue(error);
          consoleFeed.error(`NPC generation failed: ${message}`);
          throw createWebOperationError(message, consoleFeed.read(), providerDebug.entries);
        }
        return {
          ok: true,
          console: consoleFeed.read(),
          log: emptyLogResponse(await listSessionLogFiles(config.logDir, null)),
          npcs: await readNpcs(sessionId),
          providerDebug: providerDebug.entries
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
        activeOperation: activeOperation?.name ?? null,
        console: consoleFeed.read(),
        log: await readLog({ sessionId: options.sessionId ?? DEFAULT_SESSION_ID }),
        npcs: await readNpcs()
      };
    },
    async refresh(forceReingest) {
      return runExclusive(forceReingest ? "force-reingest" : "refresh", async (timing, abortSignal) => {
        const summary = await timing.reporter.time(timing, "web.refresh.run", () => runRefreshTask(forceReingest, abortSignal));
        return {
          ok: true,
          console: consoleFeed.read(),
          summary,
          log: emptyLogResponse(await listSessionLogFiles(config.logDir, null)),
          npcs: await readNpcs()
        };
      }, { cancelStartupRefresh: forceReingest });
    },
    startStartupRefresh,
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
  providerDebug?: ChatCompletionDiagnostic[];
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

const createWebOperationError = (
  message: string,
  console: WebConsoleResponse,
  providerDebug: ChatCompletionDiagnostic[] = []
): WebOperationError => ({
  console,
  kind: "web-operation",
  message,
  ...(providerDebug.length > 0 ? { providerDebug } : {})
});

const createProviderDebugCollector = (config: RuntimeConfig): {
  collect: (diagnostic: ChatCompletionDiagnostic) => void;
  entries: ChatCompletionDiagnostic[];
} => {
  const entries: ChatCompletionDiagnostic[] = [];

  return {
    collect(diagnostic) {
      if (config.provider.debug) {
        entries.push(diagnostic);
      }
    },
    entries
  };
};

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

interface CachedPartyContextService extends PartyContextService {
  clear(): void;
}

const createCachedPartyContextService = (inner: PartyContextService): CachedPartyContextService => {
  let cached: Promise<string> | null = null;

  return {
    build(config) {
      cached ??= inner.build(config).catch((error: unknown) => {
        cached = null;
        throw error;
      });
      return cached;
    },
    clear() {
      cached = null;
    }
  };
};

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
  let hasDroppedEntriesNotice = false;

  const append = (level: WebConsoleLevel, message: string): void => {
    const entry = {
      id: String(nextId),
      level,
      message,
      timestamp: new Date().toISOString()
    };
    entries.push(entry);
    nextId += 1;
    if (entries.length > MAX_CONSOLE_ENTRIES) {
      const overflow = entries.length - MAX_CONSOLE_ENTRIES;
      entries.splice(0, overflow);
      if (!hasDroppedEntriesNotice) {
        hasDroppedEntriesNotice = true;
        const notice = {
          id: String(nextId),
          level: "warn" as const,
          message: `Console history is capped at ${MAX_CONSOLE_ENTRIES} entries; older output was discarded.`,
          timestamp: new Date().toISOString()
        };
        entries.unshift(notice);
        nextId += 1;
        if (entries.length > MAX_CONSOLE_ENTRIES) {
          entries.splice(MAX_CONSOLE_ENTRIES);
        }
      }
    }
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
