import type { CorpusChunk, CorpusSource, RefreshOperationKind } from '@/types.js';
import type { IngestedArticle } from '@/server/v2/db/app/index.js';

export interface RefreshRuntimePaths {
    articleHtmlCacheDir: string;
    foundryExportDir: string;
    pdfDir: string;
    repoRoot: string;
    retrievalDir: string;
}

export interface RefreshProviderSettings {
    apiKey: string | null;
    baseUrl: string;
    embeddingModel: string;
}

export interface FoundryExportMarker {
    deleteCount: number;
    filename: string;
    generatedAt: string;
    recordCount: number;
    runId: string;
    schemaVersion: string;
    upsertCount: number;
}

export interface FoundryDiscoveryResult {
    markers: FoundryExportMarker[];
    scheduledMarkers: FoundryExportMarker[];
}

export interface PdfDiscoveryResult {
    currentFilenames: string[];
    removedFilenames: string[];
    scheduledFilenames: string[];
}

export interface ArticleDiscoveryResult {
    currentArticles: IngestedArticle[];
    shouldRefreshIndex: boolean;
}

export interface RefreshDiscoveryResult {
    article: ArticleDiscoveryResult;
    foundry: FoundryDiscoveryResult;
    pdf: PdfDiscoveryResult;
}

export interface SourceChangeSet {
    clearSourceType?: 'article' | 'foundry' | 'pdf';
    changes: Array<
        | { kind: 'delete'; sourceKey: string; sourceType: 'article' | 'foundry' | 'pdf' }
        | { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource }
    >;
}

export interface IngestionResult {
    articleRows: IngestedArticle[];
    corpusChanged: boolean;
    foundryAppliedMarkers: FoundryExportMarker[];
    pdfFilenames: string[];
    sourceChangeSet: SourceChangeSet;
}

export interface RefreshPipelineResult {
    corpusChanged: boolean;
    kind: RefreshOperationKind;
}

export interface PdfParser {
    parse(filePath: string): Promise<{
        fingerprint: string | null;
        pageCount: number;
        pages: Array<{
            pageNumber: number;
            text: string;
        }>;
        title: string | null;
    }>;
}
