import { loadDefaultConfig } from "../config/index.js";
import { FilesystemIngestionService, SqliteCorpusStore, type IngestionService } from "../ingestion/index.js";
import { ConsoleProgressReporter, type ProgressReporter } from "../progress/reporter.js";
import {
  FilesystemSourceDiscoveryService,
  type SourceDiscoveryService
} from "../source-discovery/index.js";
import { FilesystemStateStore, type StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";
import { StubPromptShell, type PromptShell } from "./prompt.js";
import { runStartupRefresh } from "./refresh.js";

export interface RuntimeDependencies {
  config?: RuntimeConfig;
  discovery?: SourceDiscoveryService;
  ingestion?: IngestionService;
  prompt?: PromptShell;
  reporter?: ProgressReporter;
  stateStore?: StateStore;
}

export async function runRuntime(
  options: RuntimeOptions,
  dependencies: RuntimeDependencies = {}
): Promise<StartupRefreshSummary> {
  const config = dependencies.config ?? loadDefaultConfig();
  const reporter = dependencies.reporter ?? new ConsoleProgressReporter();
  const discovery = dependencies.discovery ?? new FilesystemSourceDiscoveryService();
  const ingestion =
    dependencies.ingestion ??
    new FilesystemIngestionService({
      corpusStore: new SqliteCorpusStore(),
      reporter
    });
  const stateStore = dependencies.stateStore ?? new FilesystemStateStore();

  const summary = await runStartupRefresh(config, options, {
    discovery,
    ingestion,
    reporter,
    stateStore
  });

  const prompt = dependencies.prompt ?? new StubPromptShell({ reporter });
  await prompt.start();

  return summary;
}
