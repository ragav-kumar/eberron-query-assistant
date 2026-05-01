import type { IngestionService } from "../ingestion/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import type { RetrievalService, RetrievalSyncSummary } from "../retrieval/index.js";
import type { SourceDiscoveryService } from "../source-discovery/index.js";
import type { StateStore } from "../state/index.js";
import type {
  RuntimeConfig,
  RuntimeOptions,
  SourceIngestionSummary,
  SourceInventoryResult,
  SourceType,
  StartupRefreshSummary
} from "../types.js";
import { createTaggedError } from "../errors.js";

export interface StartupRefreshDependencies {
  discovery: SourceDiscoveryService;
  ingestion: IngestionService;
  reporter: ProgressReporter;
  retrieval?: RetrievalService;
  stateStore: StateStore;
}

export const runStartupRefresh = async (
  config: RuntimeConfig,
  options: RuntimeOptions,
  dependencies: StartupRefreshDependencies
): Promise<StartupRefreshSummary> => {
  dependencies.reporter.info("Starting source inventory checks.");
  const stateLoad = await dependencies.stateStore.load(config);
  const state = stateLoad.state;

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

  const ingestion = await dependencies.ingestion.ingest(config, options, state, discovery);

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
    throw createTaggedError("empty-corpus", "Startup refresh produced no ingestible corpus sources.");
  }

  const retrieval = dependencies.retrieval
    ? await refreshRetrievalIndexes(config, options, dependencies)
    : undefined;

  await dependencies.stateStore.save(config, ingestion.nextState);

  const degradation = summarizeDegradation(discovery.inventories, ingestion.summary.sourceSummaries);
  if (degradation.degradedSources.length > 0) {
    dependencies.reporter.warn(
      `Startup refresh complete in degraded mode; entering assistant prompt. degradedSources=${degradation.degradedSources.join(", ")}; ${degradation.details.join(" ")}`
    );
  } else {
    dependencies.reporter.info("Startup refresh complete; entering assistant prompt.");
  }

  return {
    forceReingest: options.forceReingest,
    inventories: discovery.inventories,
    degraded: degradation.degradedSources.length > 0,
    degradedSources: degradation.degradedSources,
    ...(retrieval ? { retrieval } : {})
  };
};

const refreshRetrievalIndexes = async (
  config: RuntimeConfig,
  options: RuntimeOptions,
  dependencies: StartupRefreshDependencies
): Promise<RetrievalSyncSummary | undefined> => {
  if (!dependencies.retrieval) {
    return undefined;
  }

  dependencies.reporter.info("Refreshing retrieval indexes.");
  const retrieval = await dependencies.retrieval.refresh(config, {
    forceRebuild: options.forceReingest
  });
  dependencies.reporter.info("Retrieval indexes ready.");
  return retrieval;
};

const summarizeDegradation = (
  inventories: SourceInventoryResult[],
  sourceSummaries: SourceIngestionSummary[]
): { degradedSources: SourceType[]; details: string[] } => {
  const degradedSources: SourceType[] = [];
  const details: string[] = [];

  for (const sourceType of orderedSourceTypes) {
    const inventory = inventories.find((candidate) => candidate.sourceType === sourceType);
    const ingestion = sourceSummaries.find((candidate) => candidate.sourceType === sourceType);
    const sourceDetails: string[] = [];

    if (inventory?.status === "failed" || (inventory?.failed ?? 0) > 0) {
      sourceDetails.push("discovery failed");
    }

    if (ingestion?.status === "failed") {
      sourceDetails.push("ingestion failed");
    } else if ((ingestion?.failed ?? 0) > 0) {
      sourceDetails.push("partial ingestion failure");
    }

    if (sourceDetails.length > 0) {
      degradedSources.push(sourceType);
      details.push(`${sourceType}: ${sourceDetails.join(", ")}.`);
    }
  }

  return { degradedSources, details };
};

const orderedSourceTypes: SourceType[] = ["foundry", "pdf", "article"];
