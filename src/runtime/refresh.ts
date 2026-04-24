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
  const state = await dependencies.stateStore.load(config);

  if (options.forceReingest) {
    dependencies.reporter.info("Force re-ingest requested; source inventory will schedule all available sources.");
  }

  const discovery = await dependencies.discovery.inspectSources(config, options, state);
  await dependencies.stateStore.save(config, discovery.nextState);

  for (const inventory of discovery.inventories) {
    const report = `${inventory.message} discovered=${inventory.discovered}, added=${inventory.added}, updated=${inventory.updated}, removed=${inventory.removed}, failed=${inventory.failed}, status=${inventory.status}.`;

    if (inventory.status === "failed") {
      dependencies.reporter.warn(report);
    } else {
      dependencies.reporter.info(report);
    }
  }

  dependencies.reporter.info("Placeholder retrieval refresh complete.");
  dependencies.reporter.info(
    discovery.degraded
      ? "Startup refresh complete with degraded source inventory; entering assistant prompt."
      : "Startup refresh complete; entering assistant prompt."
  );

  return {
    forceReingest: options.forceReingest,
    inventories: discovery.inventories,
    degraded: discovery.degraded
  };
}
