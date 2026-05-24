import path from 'node:path';

import { createTaggedError, throwIfAborted } from '@/errors.js';
import { initializeSettingsStore, settingsStore, type AppDb } from '@server/db/app/index.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    type CorpusRetrievalService,
    type CorpusStore,
    type ProgressReporter,
} from '@server/db/corpus/index.js';
import type { RefreshOperationKind } from '@/types.js';

import { discoverRefreshWork } from './discovery/index.js';
import { createOpenAiEmbeddingAdapter } from './embedding-adapter.js';
import type { ArticleFetcher } from './ingestion/article.js';
import { createFetchArticleFetcher } from './ingestion/article.js';
import { buildRefreshIngestion } from './ingestion/index.js';
import { createImportStateStore, type ImportStateStore } from './import-state.js';
import type { PdfParser, RuntimePaths } from './types.js';
import { createPdfDataExtractParser } from './ingestion/pdf.js';
import type { RefreshPipelineResult } from './types.js';
import type { OpenAiEmbeddingConfig } from './embedding-adapter.js';

/**
 * Optional seams for composing or testing the refresh pipeline.
 */
export interface RefreshPipelineDependencies {
    articleFetcher?: ArticleFetcher;
    corpusStore?: CorpusStore;
    importStateStore?: ImportStateStore;
    now?: () => Date;
    pdfParser?: PdfParser;
    repoRoot?: string;
    retrievalFactory?: (reporter: ProgressReporter) => Promise<CorpusRetrievalService | null>;
}

/**
 * End-to-end contract for a single refresh or reingest run.
 */
export interface RefreshPipeline {
    run(kind: RefreshOperationKind, options?: { abortSignal?: AbortSignal; reporter?: ProgressReporter }): Promise<RefreshPipelineResult>;
}

/**
 * Creates the concrete refresh pipeline.
 *
 * The pipeline does the actual work of the feature: discovery, ingestion,
 * corpus writes, retrieval refresh, and only then app-owned state persistence.
 */
export const createRefreshPipeline = (
    appDb: AppDb,
    dependencies: RefreshPipelineDependencies = {},
): RefreshPipeline => {
    const corpusStore = dependencies.corpusStore ?? createCorpusStore();
    const importStateStore = dependencies.importStateStore ?? createImportStateStore(appDb);
    const now = dependencies.now ?? (() => new Date());
    const articleFetcher = dependencies.articleFetcher ?? createFetchArticleFetcher();
    const pdfParser = dependencies.pdfParser ?? createPdfDataExtractParser();
    const repoRoot = dependencies.repoRoot ?? process.cwd();
    const retrievalFactory = dependencies.retrievalFactory ?? ((pipelineReporter) => {
        const store = settingsStore();
        const providerSettings: OpenAiEmbeddingConfig = {
            apiKey: store.read('providerApiKey'),
            baseUrl: store.read('providerBaseUrl'),
            embeddingModel: store.read('providerEmbeddingModel'),
        };
        return Promise.resolve(createCorpusRetrievalService({
            embeddingAdapter: createOpenAiEmbeddingAdapter(providerSettings),
            maxVectorCacheDatabaseBytes: store.read('retrievalMaxVectorCacheDatabaseBytes'),
            reporter: pipelineReporter,
        }));
    });

    return {
        run: async (kind, options = {}) => {
            const reporter = options.reporter ?? {
                info: () => undefined,
                warn: () => undefined,
            };
            const forceReingest = kind === 'reingest';
            reporter.info(kind === 'refresh' ? 'Preparing refresh runtime settings.' : 'Preparing force reingest runtime settings.');
            await initializeSettingsStore(appDb);
            const paths = resolveRuntimePaths(repoRoot);
            const timestamp = now().toISOString();
            throwIfAborted(options.abortSignal);

            // Discovery is read-only. It decides what needs processing for this
            // run based on source surfaces plus app-owned import metadata.
            reporter.info('Starting source discovery.');
            const discovery = await discoverRefreshWork(paths, forceReingest, {
                importStateStore,
                now,
            });
            reporter.info(
                `Source discovery complete: foundryScheduled=${discovery.foundry.scheduledMarkers.length}, pdfScheduled=${discovery.pdf.scheduledFilenames.length}, pdfRemoved=${discovery.pdf.removedFilenames.length}, articleRefreshIndex=${discovery.article.shouldRefreshIndex}.`,
            );
            throwIfAborted(options.abortSignal);

            reporter.info('Preparing corpus storage.');
            await corpusStore.initialize(paths.retrievalDir, {
                allowIncompatibleReset: forceReingest,
            });
            if (forceReingest) {
                reporter.warn('Force reingest requested; clearing existing corpus sources before rebuild.');
                await corpusStore.clear(paths.retrievalDir);
            }

            // Ingestion normalizes source-specific work into corpus mutations and
            // the next import-state rows that should be persisted on success.
            reporter.info('Building ingestion change set.');
            const ingestion = await buildRefreshIngestion({
                abortSignal: options.abortSignal,
                dependencies: {
                    articleFetcher,
                    pdfParser,
                },
                discovery,
                forceReingest,
                now: timestamp,
                paths,
            });
            reporter.info(
                `Ingestion change set built: changes=${ingestion.sourceChangeSet.changes.length}, corpusChanged=${ingestion.corpusChanged}, articles=${ingestion.articleRows.length}, pdfFiles=${ingestion.pdfFilenames.length}.`,
            );
            throwIfAborted(options.abortSignal);

            if (ingestion.sourceChangeSet.changes.length > 0) {
                reporter.info(`Applying ${ingestion.sourceChangeSet.changes.length} corpus source changes.`);
                await corpusStore.applySourceChanges(paths.retrievalDir, {
                    changes: ingestion.sourceChangeSet.changes,
                });
            } else {
                reporter.info('No corpus source changes were required.');
            }

            const corpusSourceCount = await corpusStore.countSources(paths.retrievalDir);
            if (corpusSourceCount === 0) {
                throw createTaggedError('empty-corpus', 'Refresh produced no ingestible corpus sources.');
            }

            const retrieval = await retrievalFactory(reporter);
            if (retrieval) {
                // Retrieval artifacts are part of the trusted output of refresh.
                // If this step fails, import state must not advance.
                if (ingestion.corpusChanged || forceReingest) {
                    reporter.info('Refreshing retrieval artifacts.');
                    await retrieval.refresh(paths.retrievalDir, {
                        abortSignal: options.abortSignal,
                        forceRebuild: forceReingest,
                    });
                } else {
                    reporter.info('Corpus is unchanged; preparing retrieval service without a rebuild.');
                    await retrieval.prepare(paths.retrievalDir);
                }
            }

            // App-owned state advances only after corpus and retrieval are both
            // in a trustworthy state.
            reporter.info('Persisting app-owned refresh state.');
            await importStateStore.replaceFiles('foundry', discovery.foundry.markers.map(marker => marker.filename));
            await importStateStore.replaceFiles('pdf', ingestion.pdfFilenames);
            await importStateStore.replaceArticles(ingestion.articleRows);
            if (discovery.article.shouldRefreshIndex) {
                await importStateStore.writeArticleLastSuccessfulIndexScrapeAt(timestamp);
            }
            const latestFoundryMarker = discovery.foundry.markers.at(-1) ?? null;
            if (latestFoundryMarker) {
                await importStateStore.writeFoundry(latestFoundryMarker);
            }
            reporter.info('Refresh pipeline completed successfully.');

            return {
                corpusChanged: ingestion.corpusChanged,
                kind,
            };
        },
    };
};

/** Resolves persisted relative runtime paths against the current repo root. */
const resolveRuntimePaths = (repoRoot: string): RuntimePaths => ({
    articleHtmlCacheDir: resolvePersistedRelativePath(repoRoot, settingsStore().read('articleHtmlCacheDir'), 'articleHtmlCacheDir'),
    foundryExportDir: resolvePersistedRelativePath(repoRoot, settingsStore().read('foundrySourceDir'), 'foundrySourceDir'),
    pdfDir: resolvePersistedRelativePath(repoRoot, settingsStore().read('pdfSourceDir'), 'pdfSourceDir'),
    repoRoot,
    retrievalDir: resolvePersistedRelativePath(repoRoot, settingsStore().read('retrievalDir'), 'retrievalDir'),
});

const resolvePersistedRelativePath = (
    repoRoot: string,
    value: string,
    key: 'articleHtmlCacheDir' | 'foundrySourceDir' | 'pdfSourceDir' | 'retrievalDir',
): string => {
    if (path.isAbsolute(value)) {
        throw createTaggedError('invalid-settings-path', `Persisted setting "${key}" must be relative to the repo root.`);
    }
    return path.resolve(repoRoot, value);
};
