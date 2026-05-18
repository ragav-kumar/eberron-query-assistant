import type { SourceType } from '@/types.js';
import type { RuntimeState } from '../state/index.js';
import type { SourceDiscoveryService, SourceDiscoverySummary } from './source-discovery-service.js';

const SOURCE_TYPES: SourceType[] = ['foundry', 'pdf', 'article'];

export const createPlaceholderSourceDiscoveryService = (): SourceDiscoveryService => ({
    inspectSources: (_config: unknown, _options: unknown, state: RuntimeState): Promise<SourceDiscoverySummary> => Promise.resolve({
        inventories: SOURCE_TYPES.map((sourceType) => ({
          sourceType,
          discovered: 0,
          added: 0,
          updated: 0,
          removed: 0,
          failed: 0,
          status: 'skipped',
          message: `${sourceType}: placeholder inventory skipped.`,
          details: []
        })),
        nextState: state,
        degraded: false
      })
  });
