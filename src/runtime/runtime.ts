import { loadDefaultConfig } from "../config/index.js";
import { createFilesystemIngestionService, createSqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import { createConsoleProgressReporter, type ProgressReporter } from "../progress/reporter.js";
import {
  createFilesystemSourceDiscoveryService,
  type SourceDiscoveryService
} from "../source-discovery/index.js";
import { createFilesystemStateStore, type StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";
import { createStubPromptShell, type PromptShell } from "./prompt.js";
import { runStartupRefresh } from "./refresh.js";

export interface RuntimeDependencies {
  config?: RuntimeConfig;
  discovery?: SourceDiscoveryService;
  ingestion?: IngestionService;
  prompt?: PromptShell;
  reporter?: ProgressReporter;
  stateStore?: StateStore;
}

export const runRuntime = async (
  options: RuntimeOptions,
  dependencies: RuntimeDependencies = {}
): Promise<StartupRefreshSummary> => {
  const config = dependencies.config ?? loadDefaultConfig();
  const reporter = dependencies.reporter ?? createConsoleProgressReporter();
  const discovery = dependencies.discovery ?? createFilesystemSourceDiscoveryService();
  const ingestion =
    dependencies.ingestion ??
    createFilesystemIngestionService({
      corpusStore: createSqliteCorpusStore(),
      reporter
    });
  const stateStore = dependencies.stateStore ?? createFilesystemStateStore();

  const summary = await runStartupRefresh(config, options, {
    discovery,
    ingestion,
    reporter,
    stateStore
  });

  const prompt = dependencies.prompt ?? createStubPromptShell({ reporter });
  await prompt.start();

  return summary;
};
