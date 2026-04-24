import type { ProgressReporter } from "../progress/reporter.js";
import type { SourceDiscoveryService } from "../source-discovery/index.js";
import type { StateStore } from "../state/index.js";
import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface StartupRefreshDependencies {
  discovery: SourceDiscoveryService;
  reporter: ProgressReporter;
  stateStore: StateStore;
}

export async function runStartupRefresh(
  config: RuntimeConfig,
  options: RuntimeOptions,
  dependencies: StartupRefreshDependencies
): Promise<StartupRefreshSummary> {
  dependencies.reporter.info("Starting source inventory checks.");
  await dependencies.stateStore.load(config);

  if (options.forceReingest) {
    dependencies.reporter.info("Force re-ingest requested; placeholder refresh will treat all sources as scheduled.");
  }

  const inventories = await dependencies.discovery.inspectSources(config, options);

  for (const inventory of inventories) {
    dependencies.reporter.info(
      `${inventory.sourceType}: placeholder inventory complete; discovered=${inventory.discovered}, added=${inventory.added}, updated=${inventory.updated}, removed=${inventory.removed}, failed=${inventory.failed}.`
    );
  }

  dependencies.reporter.info("Placeholder retrieval refresh complete.");
  dependencies.reporter.info("Startup refresh complete; entering assistant prompt.");

  return {
    forceReingest: options.forceReingest,
    inventories,
    degraded: false
  };
}
