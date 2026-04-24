import type { RuntimeConfig } from "../types.js";
import { getAppVersion } from "../app-version.js";

export interface FoundryExportMarker {
  generatedAt: string;
  recordCount: number;
  runId: string;
}

export interface ArticleStateRecord {
  canonicalUrl: string;
  title: string | null;
  firstSeenAt: string;
  lastIngestedAt: string | null;
  scrapeStatus: "pending" | "succeeded" | "failed";
}

export interface RuntimeState {
  appVersion: string;
  foundry: {
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
  invalidated: boolean;
  invalidationReason: string | null;
}

export interface StateStore {
  load(config: RuntimeConfig): Promise<RuntimeStateLoadResult>;
  save(config: RuntimeConfig, state: RuntimeState): Promise<void>;
}

export function createDefaultRuntimeState(): RuntimeState {
  return {
    appVersion: getAppVersion(),
    foundry: {
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
}
