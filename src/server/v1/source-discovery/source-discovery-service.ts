import type { RuntimeConfig, RuntimeOptions, SourceInventoryResult } from '@/types.js';
import type { RuntimeState } from '../state/index.js';

export interface SourceDiscoverySummary {
  inventories: SourceInventoryResult[];
  nextState: RuntimeState;
  degraded: boolean;
}

export interface SourceDiscoveryService {
  inspectSources(config: RuntimeConfig, options: RuntimeOptions, state: RuntimeState): Promise<SourceDiscoverySummary>;
}
