import type { RuntimeConfig } from "../types.js";

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
  version: 1;
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

export interface StateStore {
  load(config: RuntimeConfig): Promise<RuntimeState>;
  save(config: RuntimeConfig, state: RuntimeState): Promise<void>;
}

export function createDefaultRuntimeState(): RuntimeState {
  return {
    version: 1,
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
