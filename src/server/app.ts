import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadDefaultConfig } from "../config/index.js";
import { formatThrownValue, hasErrorCode } from "../errors.js";
import { createFilesystemIngestionService, createSqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import { createOpenAiChatAdapter, createOpenAiEmbeddingAdapter, type ChatAdapter } from "../provider/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import { createSqliteRetrievalService, type RetrievalService } from "../retrieval/index.js";
import { createAssistantSession, type AssistantSession } from "../runtime/assistant-session.js";
import { runStartupRefresh } from "../runtime/refresh.js";
import { createSessionLog, type SessionLog } from "../runtime/session-log.js";
import { createFilesystemSourceDiscoveryService, type SourceDiscoveryService } from "../source-discovery/index.js";
import { createFilesystemStateStore, type StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface WebApp {
  askAssistant(prompt: string): Promise<WebOperationResult>;
  debugRetrieval(query: string): Promise<WebOperationResult>;
  getConsole(): WebConsoleResponse;
  getContext(): Promise<string>;
  getLog(): Promise<WebLogResponse>;
  getStatus(): WebStatus;
  refresh(forceReingest: boolean): Promise<WebOperationResult>;
  writeContext(markdown: string): Promise<void>;
}

export interface WebAppDependencies {
  assistant?: AssistantSession;
  chat?: ChatAdapter;
  config?: RuntimeConfig;
  discovery?: SourceDiscoveryService;
  ingestion?: IngestionService;
  log?: SessionLog;
  retrieval?: RetrievalService;
  stateStore?: StateStore;
}

export interface WebLogResponse {
  filePath: string | null;
  markdown: string;
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

export interface WebOperationResult {
  console: WebConsoleResponse;
  log: WebLogResponse;
  ok: true;
  summary?: StartupRefreshSummary;
}

export interface WebStatus {
  busy: boolean;
  operation: string | null;
}

const DEBUG_RETRIEVAL_LIMIT = 8;

export const createWebApp = (dependencies: WebAppDependencies = {}): WebApp => {
  const config = dependencies.config ?? loadDefaultConfig();
  let log: SessionLog | null = dependencies.log ?? null;
  let assistant: AssistantSession | null = dependencies.assistant ?? null;
  const consoleFeed = createMemoryConsoleFeed();

  const ensureLog = async (): Promise<SessionLog> => {
    log ??= await createSessionLog({
      logDir: config.logDir,
      title: "GUI Session"
    });
    return log;
  };
  let activeOperation: string | null = null;
  const defaultReporter = createQueuedConsoleProgressReporter(consoleFeed);
  const retrieval =
    dependencies.retrieval ??
    createSqliteRetrievalService({
      embeddingAdapter: createOpenAiEmbeddingAdapter(config.provider),
      reporter: defaultReporter
    });
  const ensureAssistant = async (): Promise<AssistantSession> => {
    assistant ??= createAssistantSession({
      assistant: config.assistant,
      chat: dependencies.chat ?? createOpenAiChatAdapter(config.provider),
      log: await ensureLog(),
      retrieval
    });
    return assistant;
  };

  const readLog = async (): Promise<WebLogResponse> => ({
    filePath: log?.filePath ?? null,
    markdown: log ? await readFile(log.filePath, "utf8") : ""
  });

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

  return {
    async askAssistant(prompt) {
      return runExclusive("assistant", async () => {
        try {
          await (await ensureAssistant()).ask(prompt);
        } catch (error) {
          consoleFeed.error(`Assistant response failed: ${formatThrownValue(error)}`);
          throw error;
        }
        return {
          ok: true,
          console: consoleFeed.read(),
          log: await readLog()
        };
      });
    },
    async debugRetrieval(query) {
      return runExclusive("debug-retrieval", async () => {
        const normalizedQuery = query.trim();
        if (normalizedQuery.length === 0) {
          throw new Error("Debug retrieval query cannot be empty.");
        }

        const results = await retrieval.search({
          query: normalizedQuery,
          limit: DEBUG_RETRIEVAL_LIMIT
        });
        appendDebugRetrievalConsoleEntries(consoleFeed, normalizedQuery, results);
        return {
          ok: true,
          console: consoleFeed.read(),
          log: await readLog()
        };
      });
    },
    getConsole() {
      return consoleFeed.read();
    },
    async getContext() {
      await ensureAdditionalContextFile(config);
      return readFile(config.assistant.additionalContextPath, "utf8");
    },
    getLog: readLog,
    getStatus() {
      return {
        busy: activeOperation !== null,
        operation: activeOperation
      };
    },
    async refresh(forceReingest) {
      return runExclusive(forceReingest ? "force-reingest" : "refresh", async () => {
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
        consoleFeed.info(formatRefreshSummaryMessage(summary));
        return {
          ok: true,
          console: consoleFeed.read(),
          summary,
          log: await readLog()
        };
      });
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
  warn(message: string): void;
}

const createMemoryConsoleFeed = (): MemoryConsoleFeed => {
  const entries: WebConsoleEntry[] = [];
  let nextId = 1;

  const append = (level: WebConsoleLevel, message: string): void => {
    entries.push({
      id: String(nextId),
      level,
      message,
      timestamp: new Date().toISOString()
    });
    nextId += 1;
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

const appendDebugRetrievalConsoleEntries = (
  consoleFeed: MemoryConsoleFeed,
  query: string,
  results: Awaited<ReturnType<RetrievalService["search"]>>
): void => {
  consoleFeed.debug(`Debug retrieval query: ${query}`);
  consoleFeed.debug(`Debug retrieval results: ${results.length}`);

  for (const [index, result] of results.entries()) {
    const locator = result.citation.locator ? ` ${result.citation.locator}` : "";
    const url = result.citation.url ? ` ${result.citation.url}` : "";
    consoleFeed.debug(
      `${index + 1}. [${result.matchKind} ${result.score.toFixed(3)}] ${result.sourceType}:${result.sourceTitle}${locator}${url} chunk=${result.chunkId}\n${result.content}`
    );
  }
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
