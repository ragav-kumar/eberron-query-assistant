export interface RuntimeOptions {
  forceReingest: boolean;
}

export interface RuntimeConfig {
  repoRoot: string;
  foundryExportDir: string;
  pdfDir: string;
  runtimeDir: string;
  stateDir: string;
  cacheDir: string;
  retrievalDir: string;
}

export type SourceType = "foundry" | "pdf" | "article";

export type SourceInventoryStatus = "skipped" | "scheduled" | "missing" | "failed";

export interface SourceInventoryResult {
  sourceType: SourceType;
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  status: SourceInventoryStatus;
  message: string;
  details: string[];
}

export interface StartupRefreshSummary {
  forceReingest: boolean;
  inventories: SourceInventoryResult[];
  degraded: boolean;
}
