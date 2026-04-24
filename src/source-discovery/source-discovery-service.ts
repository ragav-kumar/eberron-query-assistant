import type { RuntimeConfig, RuntimeOptions, SourceInventoryResult } from "../types.js";

export interface SourceDiscoveryService {
  inspectSources(config: RuntimeConfig, options: RuntimeOptions): Promise<SourceInventoryResult[]>;
}
