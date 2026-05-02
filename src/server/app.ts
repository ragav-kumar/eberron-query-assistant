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

export interface WebOperationResult {
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

  const ensureLog = async (): Promise<SessionLog> => {
    log ??= await createSessionLog({
      logDir: config.logDir,
      title: "GUI Session"
    });
    return log;
  };
  let activeOperation: string | null = null;
  const defaultReporter = createQueuedLogProgressReporter(ensureLog);
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
          await (await ensureLog()).appendMarkdown(`## Error\n\nAssistant response failed: ${formatThrownValue(error)}`);
          throw error;
        }
        return {
          ok: true,
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
        await (await ensureLog()).appendMarkdown(formatDebugRetrievalMarkdown(normalizedQuery, results));
        return {
          ok: true,
          log: await readLog()
        };
      });
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
        const reporter = createQueuedLogProgressReporter(ensureLog);
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
        await (await ensureLog()).appendMarkdown(formatRefreshSummaryMarkdown(summary));
        return {
          ok: true,
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

interface QueuedLogProgressReporter extends ProgressReporter {
  flush(): Promise<void>;
}

const createQueuedLogProgressReporter = (ensureLog: () => Promise<SessionLog>): QueuedLogProgressReporter => {
  let queue = Promise.resolve();
  const append = (label: string, message: string): void => {
    queue = queue.then(async () => {
      await (await ensureLog()).appendMarkdown(`## ${label}\n\n${message}`);
    });
  };

  return {
    async flush() {
      await queue;
    },
    info(message) {
      append("Progress", message);
    },
    progress(message) {
      append("Progress", message);
    },
    warn(message) {
      append("Warning", message);
    }
  };
};

const formatDebugRetrievalMarkdown = (
  query: string,
  results: Awaited<ReturnType<RetrievalService["search"]>>
): string => {
  const lines = [`## Debug Retrieval`, "", `Query: ${query}`, "", `Results: ${results.length}`];

  for (const [index, result] of results.entries()) {
    const locator = result.citation.locator ? ` ${result.citation.locator}` : "";
    const url = result.citation.url ? ` ${result.citation.url}` : "";
    lines.push(
      "",
      `${index + 1}. [${result.matchKind} ${result.score.toFixed(3)}] ${result.sourceType}:${result.sourceTitle}${locator}${url} chunk=${result.chunkId}`,
      "",
      result.content
    );
  }

  return lines.join("\n");
};

const formatRefreshSummaryMarkdown = (summary: StartupRefreshSummary): string => {
  const retrieval = summary.retrieval
    ? ` Retrieval chunks=${summary.retrieval.chunkCount}, reused=${summary.retrieval.reusedEmbeddings}, regenerated=${summary.retrieval.regeneratedEmbeddings}.`
    : "";
  const degraded = summary.degraded ? ` Degraded sources: ${summary.degradedSources.join(", ")}.` : "";
  return `## Refresh Complete\n\nForce reingest: ${String(summary.forceReingest)}.${retrieval}${degraded}`;
};

export const toPublicPath = (filePath: string): string => {
  return path.normalize(filePath);
};
