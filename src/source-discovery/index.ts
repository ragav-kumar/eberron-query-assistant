import type { RuntimeConfig, RuntimeOptions, SourceInventoryResult, SourceType } from "../types.js";

const SOURCE_TYPES: SourceType[] = ["foundry", "pdf", "article"];

export interface SourceDiscoveryService {
  inspectSources(config: RuntimeConfig, options: RuntimeOptions): Promise<SourceInventoryResult[]>;
}

export class PlaceholderSourceDiscoveryService implements SourceDiscoveryService {
  inspectSources(): Promise<SourceInventoryResult[]> {
    return Promise.resolve(SOURCE_TYPES.map((sourceType) => ({
      sourceType,
      discovered: 0,
      added: 0,
      updated: 0,
      removed: 0,
      failed: 0,
      status: "placeholder"
    })));
  }
}
