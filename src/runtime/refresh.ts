import type { IngestionService } from "../ingestion/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import type { SourceDiscoveryService } from "../source-discovery/index.js";
import type { StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface StartupRefreshDependencies {
  discovery: SourceDiscoveryService;
  ingestion: IngestionService;
  reporter: ProgressReporter;
  stateStore: StateStore;
}

export async function runStartupRefresh(
  config: RuntimeConfig,
  options: RuntimeOptions,
  dependencies: StartupRefreshDependencies
): Promise<StartupRefreshSummary> {
  dependencies.reporter.info("Starting source inventory checks.");
  const stateLoad = await dependencies.stateStore.load(config);
  const state = stateLoad.state;

  if (stateLoad.invalidated) {
    dependencies.reporter.warn(`Runtime state invalidated: ${stateLoad.invalidationReason}.`);
  }

  if (options.forceReingest) {
    dependencies.reporter.info("Force re-ingest requested; source inventory will schedule all available sources.");
  }

  const discovery = await dependencies.discovery.inspectSources(config, options, state);

  for (const inventory of discovery.inventories) {
    const report = `${inventory.message} discovered=${inventory.discovered}, added=${inventory.added}, updated=${inventory.updated}, removed=${inventory.removed}, failed=${inventory.failed}, status=${inventory.status}.`;

    if (inventory.status === "failed") {
      dependencies.reporter.warn(report);
    } else {
      dependencies.reporter.info(report);
    }
  }

  const ingestion = await dependencies.ingestion.ingest(config, options, state, discovery, stateLoad.invalidated);
  await dependencies.stateStore.save(config, ingestion.nextState);

  for (const summary of ingestion.summary.sourceSummaries) {
    const report = `${summary.message} discovered=${summary.discovered}, ingested=${summary.ingested}, removed=${summary.removed}, failed=${summary.failed}, status=${summary.status}.`;

    if (summary.status === "failed" || summary.failed > 0) {
      dependencies.reporter.warn(report);
    } else {
      dependencies.reporter.info(report);
    }
  }

  dependencies.reporter.info("Ingestion refresh complete.");

  if (ingestion.summary.corpusSourceCount === 0) {
    throw new Error("Startup refresh produced no ingestible corpus sources.");
  }

  dependencies.reporter.info(
    discovery.degraded || ingestion.summary.degraded
      ? "Startup refresh complete with degraded source inventory; entering assistant prompt."
      : "Startup refresh complete; entering assistant prompt."
  );

  return {
    forceReingest: options.forceReingest,
    inventories: discovery.inventories,
    degraded: discovery.degraded || ingestion.summary.degraded
  };
}
