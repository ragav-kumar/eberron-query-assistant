import { createTaggedError, throwIfAborted } from '@/errors.js';
import type { AppDb } from '@/server/v2/db/app/index.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    type CorpusRetrievalService,
    type CorpusStore,
    type ProgressReporter,
} from '@/server/v2/db/corpus/index.js';
import type { RefreshOperationKind } from '@/types.js';

import { discoverRefreshWork } from './discovery/index.js';
import { createOpenAiEmbeddingAdapter } from './embedding-adapter.js';
import type { ArticleFetcher } from './ingestion/article.js';
import { createFetchArticleFetcher } from './ingestion/article.js';
import { buildRefreshIngestion } from './ingestion/index.js';
import { createImportStateStore, type ImportStateStore } from './import-state.js';
import type { PdfParser } from './types.js';
import { createPdfDataExtractParser } from './ingestion/pdf.js';
import { initializeRefreshSettings, readRefreshProviderSettings, resolveRefreshRuntimePaths } from './runtime.js';
import type { RefreshPipelineResult } from './types.js';

export interface RefreshPipelineDependencies {
    articleFetcher?: ArticleFetcher;
    corpusStore?: CorpusStore;
    importStateStore?: ImportStateStore;
    now?: () => Date;
    pdfParser?: PdfParser;
    repoRoot?: string;
    reporter?: ProgressReporter;
    retrievalFactory?: (reporter: ProgressReporter) => Promise<CorpusRetrievalService | null>;
}

export interface RefreshPipeline {
    run(kind: RefreshOperationKind, options?: { abortSignal?: AbortSignal }): Promise<RefreshPipelineResult>;
}

export const createRefreshPipeline = (
    appDb: AppDb,
    dependencies: RefreshPipelineDependencies = {},
): RefreshPipeline => {
    const corpusStore = dependencies.corpusStore ?? createCorpusStore();
    const importStateStore = dependencies.importStateStore ?? createImportStateStore(appDb);
    const now = dependencies.now ?? (() => new Date());
    const articleFetcher = dependencies.articleFetcher ?? createFetchArticleFetcher();
    const pdfParser = dependencies.pdfParser ?? createPdfDataExtractParser();
    const reporter = dependencies.reporter ?? {
        info: () => undefined,
        warn: () => undefined,
    };
    const repoRoot = dependencies.repoRoot ?? process.cwd();
    const retrievalFactory = dependencies.retrievalFactory ?? (async (pipelineReporter) => {
        const providerSettings = await readRefreshProviderSettings(appDb, repoRoot);
        if (!providerSettings.apiKey) {
            pipelineReporter.warn('Skipping retrieval refresh because no provider API key is configured.');
            return null;
        }

        return createCorpusRetrievalService({
            embeddingAdapter: createOpenAiEmbeddingAdapter(providerSettings),
            reporter: pipelineReporter,
        });
    });

    return {
        run: async (kind, options = {}) => {
            const forceReingest = kind === 'reingest';
            await initializeRefreshSettings(appDb, repoRoot);
            const paths = await resolveRefreshRuntimePaths(appDb, repoRoot);
            const timestamp = now().toISOString();
            throwIfAborted(options.abortSignal);

            const discovery = await discoverRefreshWork(paths, forceReingest, {
                importStateStore,
                now,
            });
            throwIfAborted(options.abortSignal);

            await corpusStore.initialize(paths.retrievalDir, {
                allowIncompatibleReset: forceReingest,
            });
            if (forceReingest) {
                await corpusStore.clear(paths.retrievalDir);
            }

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
            throwIfAborted(options.abortSignal);

            if (ingestion.sourceChangeSet.changes.length > 0) {
                await corpusStore.applySourceChanges(paths.retrievalDir, {
                    changes: ingestion.sourceChangeSet.changes,
                });
            }

            const corpusSourceCount = await corpusStore.countSources(paths.retrievalDir);
            if (corpusSourceCount === 0) {
                throw createTaggedError('empty-corpus', 'Refresh produced no ingestible corpus sources.');
            }

            const retrieval = await retrievalFactory(reporter);
            if (retrieval) {
                if (ingestion.corpusChanged || forceReingest) {
                    await retrieval.refresh(paths.retrievalDir, {
                        abortSignal: options.abortSignal,
                        forceRebuild: forceReingest,
                    });
                } else {
                    await retrieval.prepare(paths.retrievalDir);
                }
            }

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

            return {
                corpusChanged: ingestion.corpusChanged,
                kind,
            };
        },
    };
};
