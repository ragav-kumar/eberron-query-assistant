import type { TimingContext } from "./timing.js";

export interface RuntimeOptions {
  forceReingest: boolean;
  retrievalQuery: string | null;
}

export interface RuntimeConfig {
  repoRoot: string;
  assistant: AssistantConfig;
  campaign: CampaignConfig;
  foundryExportDir: string;
  pdfDir: string;
  runtimeDir: string;
  logDir: string;
  stateDir: string;
  cacheDir: string;
  retrievalDir: string;
  provider: ProviderConfig;
}

export interface AssistantConfig {
  assistantDir: string;
  additionalContextPath: string;
  npcGeneratorPromptPath: string;
  sessionTitlePromptPath: string;
  systemPromptPath: string;
  worldQueryingModePromptPath: string;
}

export interface CampaignConfig {
  campaignJournalFolder: string | null;
  partyActorUuids: string[];
  questsJournal: string;
  sessionNotesJournal: string;
}

export interface ProviderConfig {
  apiKey: string | null;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
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
  degradedSources: SourceType[];
  retrieval?: {
    chunkCount: number;
    reusedEmbeddings: number;
    regeneratedEmbeddings: number;
  };
}

export interface CitationMetadata {
  sourceType: SourceType;
  label: string;
  locator: string | null;
  url: string | null;
}

export interface CorpusSource {
  sourceId: string;
  sourceType: SourceType;
  sourceKey: string;
  title: string;
  metadata: Record<string, unknown>;
  status: "succeeded" | "failed";
}

export interface CorpusChunk {
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  citation: CitationMetadata;
  metadata: Record<string, unknown>;
}

export interface RetrievalSearchRequest {
  query: string;
  sourceTypes?: SourceType[];
  sourceKeys?: string[];
  timing?: TimingContext;
  limit?: number;
}

export type RetrievalMatchKind = "lexical" | "vector" | "hybrid";

export interface RetrievalResult {
  chunkId: string;
  sourceId: string;
  sourceType: SourceType;
  sourceKey: string;
  sourceTitle: string;
  content: string;
  citation: CitationMetadata;
  score: number;
  matchKind: RetrievalMatchKind;
}

export interface SourceIngestionSummary {
  sourceType: SourceType;
  status: "skipped" | "succeeded" | "failed";
  discovered: number;
  ingested: number;
  removed: number;
  failed: number;
  message: string;
  details: string[];
}

export interface IngestionSummary {
  sourceSummaries: SourceIngestionSummary[];
  degraded: boolean;
  corpusSourceCount: number;
}
