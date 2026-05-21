import type { RuntimePaths } from '@server/settings/index.js';
import type { CorpusChunk, CorpusSource, RefreshOperationKind } from '@/types.js';
import type { IngestedArticle } from '@server/db/app/index.js';

/**
 * Parsed metadata for a Foundry export file.
 *
 * Discovery reads only the manifest line to decide whether a delta file still
 * needs to be applied.
 */
export interface FoundryExportMarker {
    deleteCount: number;
    filename: string;
    generatedAt: string;
    recordCount: number;
    runId: string;
    schemaVersion: string;
    upsertCount: number;
}

/**
 * Foundry discovery output for one run.
 */
export interface FoundryDiscoveryResult {
    markers: FoundryExportMarker[];
    scheduledMarkers: FoundryExportMarker[];
}

/**
 * PDF discovery output for one run.
 *
 * PDFs are tracked by filename, so refresh looks for additions and removals
 * relative to the last successful import state.
 */
export interface PdfDiscoveryResult {
    currentFilenames: string[];
    removedFilenames: string[];
    scheduledFilenames: string[];
}

/**
 * Article discovery output for one run.
 *
 * The article source is periodic rather than file-backed, so discovery decides
 * whether the remote index needs to be scraped.
 */
export interface ArticleDiscoveryResult {
    currentArticles: IngestedArticle[];
    shouldRefreshIndex: boolean;
}

/**
 * Combined source discovery result consumed by ingestion.
 */
export interface RefreshDiscoveryResult {
    article: ArticleDiscoveryResult;
    foundry: FoundryDiscoveryResult;
    pdf: PdfDiscoveryResult;
}

/**
 * Corpus mutations produced by refresh ingestion.
 *
 * Each source-specific ingestion pass contributes deletions and upserts which
 * are then applied as one corpus update.
 */
export interface SourceChangeSet {
    clearSourceType?: 'article' | 'foundry' | 'pdf';
    changes: Array<
        | { kind: 'delete'; sourceKey: string; sourceType: 'article' | 'foundry' | 'pdf' }
        | { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource }
    >;
}

/**
 * Internal ingestion result used by the pipeline before app-owned import state
 * is persisted.
 */
export interface IngestionResult {
    articleRows: IngestedArticle[];
    corpusChanged: boolean;
    foundryAppliedMarkers: FoundryExportMarker[];
    pdfFilenames: string[];
    sourceChangeSet: SourceChangeSet;
}

/**
 * Summary returned from one completed pipeline run.
 */
export interface RefreshPipelineResult {
    corpusChanged: boolean;
    kind: RefreshOperationKind;
}

/**
 * Minimal PDF parsing contract needed by refresh ingestion.
 *
 * The refresh service only cares about normalized page text and a small amount
 * of document metadata, so the parser interface stays intentionally narrow.
 */
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

export type { RuntimePaths };
