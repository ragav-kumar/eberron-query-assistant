import type { TimingContext } from './timing.js';

export interface RuntimeOptions {
  abortSignal?: AbortSignal | undefined;
  forceReingest: boolean;
}

/**
 * @deprecated V2 should not depend on the V1-style global runtime config object.
 * Prefer narrower V2-specific bootstraps and persisted settings boundaries.
 */
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

/**
 * @deprecated V2 should not depend on the V1-style assistant path bundle.
 * Prefer V2 prompt asset resolution at the call site.
 */
export interface AssistantConfig {
  assistantDir: string;
  additionalContextPath: string;
  npcGeneratorPromptPath: string;
  sessionTitlePromptPath: string;
  systemPromptPath: string;
  worldQueryingModePromptPath: string;
}

/**
 * @deprecated V2 should not pass campaign settings through RuntimeConfig.
 * Prefer persisted V2 settings and narrow runtime readers.
 */
export interface CampaignConfig {
  campaignJournalFolder: string | null;
  partyActorUuids: string[];
  questsJournal: string;
  sessionNotesJournal: string;
}

/**
 * @deprecated V2 should not pass provider settings through RuntimeConfig.
 * Prefer persisted V2 settings and provider-specific adapters.
 */
export interface ProviderConfig {
  apiKey: string | null;
  baseUrl: string;
  chatModel: string;
  debug: boolean;
  embeddingModel: string;
}

export const sessionModes = ['assistant', 'npc'] as const;
export type SessionMode = typeof sessionModes[number];

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RefreshOperationKind = 'refresh' | 'reingest';

export type RefreshStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

export type SessionFeedEntryKind = 'user' | 'reasoning' | 'response';

export type SourceType = 'foundry' | 'pdf' | 'article';

/**
 * @deprecated V2 does not use the V1 source-discovery inventory status model.
 */
export type SourceInventoryStatus = 'skipped' | 'scheduled' | 'missing' | 'failed';

/**
 * @deprecated V2 does not use the V1 source-discovery inventory result shape.
 */
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

/**
 * @deprecated V2 does not use the V1 startup refresh summary shape.
 */
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
  status: 'succeeded' | 'failed';
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

export type RetrievalMatchKind = 'lexical' | 'vector' | 'hybrid';

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

/**
 * @deprecated V2 does not use the V1 per-source ingestion summary model.
 */
export interface SourceIngestionSummary {
  sourceType: SourceType;
  status: 'skipped' | 'succeeded' | 'failed';
  discovered: number;
  ingested: number;
  removed: number;
  failed: number;
  message: string;
  details: string[];
}

/**
 * @deprecated V2 does not use the V1 ingestion summary shape.
 */
export interface IngestionSummary {
  sourceSummaries: SourceIngestionSummary[];
  degraded: boolean;
  corpusSourceCount: number;
}

export type ConsoleLevel = 'debug' | 'error' | 'info' | 'warn';
