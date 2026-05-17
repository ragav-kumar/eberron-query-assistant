import type { RuntimeConfig } from '@/types.js';
import { getAppVersion } from '@/app-version.js';

export interface FoundryExportMarker {
  deleteCount: number;
  filename: string;
  generatedAt: string;
  recordCount: number;
  runId: string;
  schemaVersion: string;
  upsertCount: number;
}

export interface ArticleStateRecord {
  canonicalUrl: string;
  title: string | null;
  firstSeenAt: string;
  lastIngestedAt: string | null;
  scrapeStatus: 'pending' | 'succeeded' | 'failed' | 'inaccessible';
}

export interface RuntimeState {
  appVersion: string;
  foundry: {
    appliedExportFilenames: string[];
    lastSuccessfulExport: FoundryExportMarker | null;
  };
  pdf: {
    knownFilenames: string[];
  };
  article: {
    lastSuccessfulIndexScrapeAt: string | null;
    knownArticles: ArticleStateRecord[];
  };
}

export interface RuntimeStateLoadResult {
  state: RuntimeState;
}

export interface StateStore {
  load(config: RuntimeConfig): Promise<RuntimeStateLoadResult>;
  save(config: RuntimeConfig, state: RuntimeState): Promise<void>;
}

export const createDefaultRuntimeState = (): RuntimeState => {
  return {
    appVersion: getAppVersion(),
    foundry: {
      appliedExportFilenames: [],
      lastSuccessfulExport: null
    },
    pdf: {
      knownFilenames: []
    },
    article: {
      lastSuccessfulIndexScrapeAt: null,
      knownArticles: []
    }
  };
};
