import type { RefreshDiscoveryResult, RuntimePaths } from '../types.js';
import type { ArticleFetcher } from './article.js';
import { buildArticleRefresh } from './article.js';
import { buildFoundrySourceChanges } from './foundry.js';
import type { PdfParser } from '../types.js';
import { buildPdfSourceChanges } from './pdf.js';

/**
 * Dependencies required by the source ingestion stage.
 */
export interface RefreshIngestionDependencies {
    articleFetcher: ArticleFetcher;
    pdfParser: PdfParser;
}

/**
 * Converts discovery output into corpus mutations plus the import-state rows
 * that should be persisted if the run completes successfully.
 */
export const buildRefreshIngestion = async (options: {
    abortSignal?: AbortSignal;
    dependencies: RefreshIngestionDependencies;
    discovery: RefreshDiscoveryResult;
    forceReingest: boolean;
    now: string;
    paths: RuntimePaths;
}) => {
    const [foundry, pdf, article] = await Promise.all([
        buildFoundrySourceChanges(
            options.paths,
            options.discovery.foundry.scheduledMarkers,
            options.forceReingest,
        ),
        buildPdfSourceChanges(
            options.paths,
            options.discovery.pdf.scheduledFilenames,
            options.discovery.pdf.removedFilenames,
            options.dependencies.pdfParser,
            options.forceReingest,
        ),
        buildArticleRefresh({
            abortSignal: options.abortSignal,
            currentArticles: options.discovery.article.currentArticles,
            fetcher: options.dependencies.articleFetcher,
            forceReingest: options.forceReingest,
            now: options.now,
            shouldRefreshIndex: options.discovery.article.shouldRefreshIndex,
        }),
    ]);

    const sourceChangeSet = {
        changes: [
            ...foundry.changeSet.changes,
            ...pdf.changes,
            ...article.changeSet.changes,
        ],
    };

    return {
        articleRows: article.articleRows,
        corpusChanged:
            foundry.changeSet.changes.length > 0
            || pdf.changes.length > 0
            || article.changeSet.changes.length > 0,
        foundryAppliedMarkers: foundry.appliedMarkers,
        pdfFilenames: options.discovery.pdf.currentFilenames,
        sourceChangeSet,
    };
};
