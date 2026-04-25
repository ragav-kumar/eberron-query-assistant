import type { SourceDiscoverySummary } from "../source-discovery/index.js";
import type { RuntimeState } from "../state/index.js";
import type { IngestionSummary, RuntimeConfig, RuntimeOptions } from "../types.js";
import type { IngestionService } from "./ingestion-service.js";

export function createPlaceholderIngestionService(): IngestionService {
  return {
    ingest(
      _config: RuntimeConfig,
      _options: RuntimeOptions,
      _state: RuntimeState,
      discovery: SourceDiscoverySummary
    ): Promise<{ summary: IngestionSummary; nextState: RuntimeState }> {
      return Promise.resolve({
        summary: {
          degraded: false,
          corpusSourceCount: 1,
          sourceSummaries: discovery.inventories.map((inventory) => ({
            sourceType: inventory.sourceType,
            status: inventory.status === "failed" ? "failed" : "skipped",
            discovered: inventory.discovered,
            ingested: 0,
            removed: 0,
            failed: inventory.failed,
            message: `${inventory.sourceType}: placeholder ingestion skipped.`,
            details: []
          }))
        },
        nextState: discovery.nextState
      });
    }
  };
}
