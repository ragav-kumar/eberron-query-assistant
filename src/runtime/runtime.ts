import { loadDefaultConfig } from "../config/index.js";
import { createFilesystemIngestionService, createSqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import { createConsoleProgressReporter, createMemoryProgressReporter, type ProgressReporter } from "../progress/reporter.js";
import {
  createOpenAiChatAdapter,
  createOpenAiEmbeddingAdapter,
  type ChatAdapter,
  type EmbeddingAdapter
} from "../provider/index.js";
import { createSqliteRetrievalService, type RetrievalService } from "../retrieval/index.js";
import {
  createFilesystemSourceDiscoveryService,
  type SourceDiscoveryService
} from "../source-discovery/index.js";
import { createFilesystemStateStore, type StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";
import { createAssistantPromptShell, type PromptShell } from "./prompt.js";
import { runStartupRefresh } from "./refresh.js";

export interface RuntimeDependencies {
  chat?: ChatAdapter;
  config?: RuntimeConfig;
  discovery?: SourceDiscoveryService;
  embedding?: EmbeddingAdapter;
  ingestion?: IngestionService;
  prompt?: PromptShell;
  reporter?: ProgressReporter;
  retrieval?: RetrievalService;
  stateStore?: StateStore;
}

export const runRuntime = async (
  options: RuntimeOptions,
  dependencies: RuntimeDependencies = {}
): Promise<StartupRefreshSummary> => {
  const config = dependencies.config ?? loadDefaultConfig();
  const reporter = dependencies.reporter ?? createConsoleProgressReporter();
  const serviceReporter = options.retrievalQuery && !dependencies.reporter ? createMemoryProgressReporter() : reporter;
  const discovery = dependencies.discovery ?? createFilesystemSourceDiscoveryService();
  const ingestion =
    dependencies.ingestion ??
    createFilesystemIngestionService({
      corpusStore: createSqliteCorpusStore(),
      reporter: serviceReporter
    });
  const stateStore = dependencies.stateStore ?? createFilesystemStateStore();
  const retrieval =
    dependencies.retrieval ??
    createSqliteRetrievalService({
      embeddingAdapter: dependencies.embedding ?? createOpenAiEmbeddingAdapter(config.provider),
      reporter: serviceReporter
    });

  const summary = await runStartupRefresh(config, options, {
    discovery,
    ingestion,
    reporter: serviceReporter,
    retrieval,
    stateStore
  });

  if (options.retrievalQuery) {
    const results = await retrieval.search({
      query: options.retrievalQuery,
      limit: 8
    });
    const retrievalSummary = summary.retrieval
      ? ` chunks=${summary.retrieval.chunkCount}, reused=${summary.retrieval.reusedEmbeddings}, regenerated=${summary.retrieval.regeneratedEmbeddings}.`
      : "";
    reporter.info(`Retrieval debug refresh complete.${retrievalSummary}`);
    reporter.info(`Results for "${options.retrievalQuery}": ${results.length}.`);
    for (const [index, result] of results.entries()) {
      const locator = result.citation.locator ? ` ${result.citation.locator}` : "";
      const url = result.citation.url ? ` ${result.citation.url}` : "";
      reporter.info(
        `${index + 1}. [${result.matchKind} ${result.score.toFixed(3)}] ${result.sourceType}:${result.sourceTitle}${locator}${url} chunk=${result.chunkId}`
      );
    }
    return summary;
  }

  const prompt =
    dependencies.prompt ??
    createAssistantPromptShell({
      assistant: config.assistant,
      chat: dependencies.chat ?? createOpenAiChatAdapter(config.provider),
      config,
      logDir: config.logDir,
      reporter,
      retrieval
    });
  await prompt.start();

  return summary;
};
