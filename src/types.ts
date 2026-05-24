import type { TimingContext } from './timing.js';

export const sessionModes = ['assistant', 'npc'] as const;
export type SessionMode = typeof sessionModes[number];

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RefreshOperationKind = 'refresh' | 'reingest';

export type RefreshStatus = 'pending' | 'running' | 'completed' | 'failed';

export type SessionFeedEntryKind = 'user' | 'reasoning' | 'response';

export type SourceType = 'foundry' | 'pdf' | 'article';

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

export type ConsoleLevel = 'debug' | 'error' | 'info' | 'warn';
