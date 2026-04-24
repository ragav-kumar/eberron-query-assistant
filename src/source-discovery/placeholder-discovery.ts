import type { SourceInventoryResult, SourceType } from "../types.js";
import type { SourceDiscoveryService } from "./source-discovery-service.js";

const SOURCE_TYPES: SourceType[] = ["foundry", "pdf", "article"];

export class PlaceholderSourceDiscoveryService implements SourceDiscoveryService {
  inspectSources(): Promise<SourceInventoryResult[]> {
    return Promise.resolve(
      SOURCE_TYPES.map((sourceType) => ({
        sourceType,
        discovered: 0,
        added: 0,
        updated: 0,
        removed: 0,
        failed: 0,
        status: "placeholder"
      }))
    );
  }
}
