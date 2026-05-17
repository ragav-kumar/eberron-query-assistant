import { formatThrownValue, isOperationAbortedError, throwIfAborted } from '@/errors.js';
import type { ProgressReporter } from '../progress/reporter.js';
import type { SourceDiscoverySummary } from '../source-discovery/index.js';
import type { ArticleStateRecord, RuntimeState, StateStore } from '../state/index.js';
import type { IngestionSummary, RuntimeConfig, RuntimeOptions, SourceIngestionSummary } from '@/types.js';
import {
  createFetchArticleFetcher,
  KEITH_BAKER_INDEX_URL,
  type ArticleFetcher,
  discoverArticleLinks,
  isPermanentlyInaccessibleArticleFetch,
  normalizeArticle
} from './article-ingestion.js';
import { createFilesystemArticleRawCache, type ArticleRawCache } from './article-raw-cache.js';
import type { CorpusStore } from './corpus-store.js';
import { parseFoundryDeltaFile, type FoundryDeltaFile } from './foundry-ingestion.js';
import { createPdfDataExtractParser, type PdfParser, normalizePdf } from './pdf-ingestion.js';

export interface IngestionServiceDependencies {
  articleRawCache?: ArticleRawCache;
  articleFetcher?: ArticleFetcher;
  corpusStore: CorpusStore;
  now?: () => Date;
  pdfParser?: PdfParser;
  reporter: ProgressReporter;
  stateStore?: StateStore;
}

export interface IngestionService {
  ingest(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary
  ): Promise<{
    summary: IngestionSummary;
    nextState: RuntimeState;
  }>;
}

export const createFilesystemIngestionService = (dependencies: IngestionServiceDependencies): IngestionService => {
  const articleRawCache = dependencies.articleRawCache ?? createFilesystemArticleRawCache();
  const articleFetcher = dependencies.articleFetcher ?? createFetchArticleFetcher();
  const corpusStore = dependencies.corpusStore;
  const now = dependencies.now ?? (() => new Date());
  const pdfParser = dependencies.pdfParser ?? createPdfDataExtractParser();

  const ingestFoundry = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> => {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === 'foundry');
    throwIfAborted(options.abortSignal);
    if (!inventory || inventory.status !== 'scheduled') {
      return skippedSummary('foundry', 'foundry: ingestion skipped.');
    }

    const scheduledFilenames = readScheduledFilenames(inventory.details);
    const allAppliedFilenames = [...discovery.nextState.foundry.appliedExportFilenames];
    const isBackfill = scheduledFilenames.some(
      (filename) => state.foundry.lastSuccessfulExport && filename.localeCompare(state.foundry.lastSuccessfulExport.filename) < 0
    );
    const filenames = isBackfill ? allAppliedFilenames : scheduledFilenames;
    if (filenames.length === 0) {
      return failedSummary('foundry', 'foundry: scheduled without delta export filenames.');
    }

    let ingested = 0;
    let removed = 0;

    try {
      const parsedFiles = isBackfill
        ? await Promise.all(filenames.map((filename) => parseFoundryDeltaFile(config, filename)))
        : [];
      let clearFoundryBeforeNextFile = isBackfill;

      if (isBackfill) {
        dependencies.reporter.warn(
          `foundry: late backfilled delta export detected; replaying ${filenames.length} foundry export file(s).`
        );
        resetFoundryState(nextState);
      }

      for (const [index, filename] of filenames.entries()) {
        throwIfAborted(options.abortSignal);
        const parsed = isBackfill ? parsedFiles[index] : await parseFoundryDeltaFile(config, filename);
        if (!parsed) {
          throw new Error(`Missing parsed delta export ${filename}.`);
        }

        dependencies.reporter.info(`foundry: applying ${filename} (${index + 1}/${filenames.length}).`);
        const applied = await applyFoundryDeltaFile(corpusStore, config, parsed, clearFoundryBeforeNextFile);
        clearFoundryBeforeNextFile = false;
        ingested += applied.upsertCount;
        removed += applied.deleteCount;
        applyFoundryMarker(nextState, parsed.marker);
        await dependencies.stateStore?.save(config, nextState);
        throwIfAborted(options.abortSignal);
        dependencies.reporter.info(
          `foundry: applied ${filename}; upserts=${applied.upsertCount}, deletes=${applied.deleteCount}.`
        );
      }

      return succeededSummary(
        'foundry',
        inventory.discovered,
        ingested,
        removed,
        isBackfill ? 'foundry: replayed delta export history after backfill.' : 'foundry: applied delta export files.',
        filenames.map((filename) => `applied:${filename}`)
      );
    } catch (error) {
      if (isOperationAbortedError(error)) {
        throw error;
      }
      return {
        sourceType: 'foundry',
        status: 'failed',
        discovered: inventory.discovered,
        ingested,
        removed,
        failed: 1,
        message: `foundry: ingestion failed: ${formatThrownValue(error)}.`,
        details: [formatThrownValue(error)]
      };
    }
  };

  const ingestPdf = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> => {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === 'pdf');
    throwIfAborted(options.abortSignal);
    if (!inventory || inventory.status !== 'scheduled') {
      return skippedSummary('pdf', 'pdf: ingestion skipped.');
    }

    const added = inventory.details
      .filter((detail) => detail.startsWith('added:'))
      .map((detail) => detail.slice('added:'.length));
    const removed = inventory.details
      .filter((detail) => detail.startsWith('removed:'))
      .map((detail) => detail.slice('removed:'.length));
    const filenames = inventory.added > 0 && added.length === 0 ? discovery.nextState.pdf.knownFilenames : added;

    let ingested = 0;
    let failed = 0;
    const details: string[] = [];

    for (const filename of removed) {
      throwIfAborted(options.abortSignal);
      dependencies.reporter.info(`pdf: removing stale source ${filename}.`);
      await corpusStore.removeSource(config, 'pdf', filename);
    }

    for (const [index, filename] of filenames.entries()) {
      throwIfAborted(options.abortSignal);
      try {
        dependencies.reporter.info(`pdf: parsing ${filename} (${index + 1}/${filenames.length}).`);
        const normalized = await normalizePdf(config, filename, pdfParser);
        await corpusStore.replaceSource(config, normalized.source, normalized.chunks);
        dependencies.reporter.info(`pdf: indexed ${filename} with ${normalized.chunks.length} chunks.`);
        ingested += 1;
        throwIfAborted(options.abortSignal);
      } catch (error) {
        if (isOperationAbortedError(error)) {
          throw error;
        }
        failed += 1;
        dependencies.reporter.warn(`pdf: failed ${filename}: ${formatThrownValue(error)}.`);
        details.push(`${filename}: ${formatThrownValue(error)}`);
      }
    }

    if (failed === 0) {
      nextState.pdf.knownFilenames = [...discovery.nextState.pdf.knownFilenames];
      return succeededSummary('pdf', inventory.discovered, ingested, removed.length, 'pdf: ingested inventory changes.', details);
    }

    return {
      sourceType: 'pdf',
      status: ingested > 0 || removed.length > 0 ? 'succeeded' : 'failed',
      discovered: inventory.discovered,
      ingested,
      removed: removed.length,
      failed,
      message:
        ingested > 0 || removed.length > 0
          ? 'pdf: ingestion completed with source-scoped failures.'
          : 'pdf: ingestion failed.',
      details
    };
  };

  const ingestArticles = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> => {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === 'article');
    throwIfAborted(options.abortSignal);
    if (!inventory || inventory.status !== 'scheduled') {
      return skippedSummary('article', 'article: ingestion skipped.');
    }

    const nowIso = now().toISOString();
    try {
      const indexHtml = await readArticleIndexHtml({
        abortSignal: options.abortSignal,
        articleFetcher,
        articleRawCache,
        config,
        forceReingest: options.forceReingest,
        reporter: dependencies.reporter
      });
      const discovered = discoverArticleLinks(indexHtml, state.article.knownArticles, nowIso);
      const articleMap = new Map(discovered.articles.map((article) => [article.canonicalUrl, article]));
      const ingestCandidates = discovered.articles.filter(
        (article) =>
          article.scrapeStatus !== 'inaccessible' &&
          (options.forceReingest || article.scrapeStatus !== 'succeeded' || !article.lastIngestedAt)
      );

      let ingested = 0;
      let failed = 0;
      const details: string[] = [];
      dependencies.reporter.info(
        `article: discovered ${discovered.discoveredUrls.length} URLs; ingesting ${ingestCandidates.length} article pages.`
      );

      for (const [index, article] of ingestCandidates.entries()) {
        throwIfAborted(options.abortSignal);
        try {
          const html = await readArticleHtml({
            abortSignal: options.abortSignal,
            article,
            articleFetcher,
            articleRawCache,
            config,
            forceReingest: options.forceReingest,
            index,
            total: ingestCandidates.length,
            reporter: dependencies.reporter
          });
          const normalized = normalizeArticle(article.canonicalUrl, html, article, nowIso);
          await corpusStore.replaceSource(config, normalized.source, normalized.chunks);
          articleMap.set(article.canonicalUrl, normalized.article);
          dependencies.reporter.info(
            `article: indexed ${normalized.article.title ?? article.canonicalUrl} with ${normalized.chunks.length} chunks.`
          );
          ingested += 1;
          throwIfAborted(options.abortSignal);
        } catch (error) {
          const permanentlyInaccessible = isPermanentlyInaccessibleArticleFetch(error);
          if (permanentlyInaccessible) {
            dependencies.reporter.warn(`article: permanently inaccessible ${article.canonicalUrl}: ${formatThrownValue(error)}.`);
            details.push(`${article.canonicalUrl}: permanently inaccessible (${error.status})`);
          } else {
            failed += 1;
            dependencies.reporter.warn(`article: failed ${article.canonicalUrl}: ${formatThrownValue(error)}.`);
            details.push(`${article.canonicalUrl}: ${formatThrownValue(error)}`);
          }
          articleMap.set(article.canonicalUrl, {
            ...article,
            scrapeStatus: permanentlyInaccessible ? 'inaccessible' : 'failed'
          });
        }
      }

      nextState.article.lastSuccessfulIndexScrapeAt = failed === 0 ? nowIso : state.article.lastSuccessfulIndexScrapeAt;
      nextState.article.knownArticles = sortArticles([...articleMap.values()]);

      return {
        sourceType: 'article',
        status: failed > 0 && ingested === 0 ? 'failed' : 'succeeded',
        discovered: discovered.discoveredUrls.length,
        ingested,
        removed: 0,
        failed,
        message:
          failed > 0
            ? 'article: ingestion completed with source-scoped failures.'
            : details.length > 0
              ? 'article: discovered article changes with permanently inaccessible pages.'
            : 'article: discovered and ingested article changes.',
        details
      };
    } catch (error) {
      if (isOperationAbortedError(error)) {
        throw error;
      }
      return failedSummary('article', `article: ingestion failed: ${formatThrownValue(error)}.`);
    }
  };

  return {
    async ingest(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary
    ) {
      await corpusStore.initialize(config, { allowIncompatibleReset: options.forceReingest });
      throwIfAborted(options.abortSignal);
      if (options.forceReingest) {
        await corpusStore.clear(config);
      }
      throwIfAborted(options.abortSignal);

      const nextState = cloneRuntimeState(state);
      const summaries: SourceIngestionSummary[] = [];

      summaries.push(await ingestFoundry(config, options, state, discovery, nextState));
      summaries.push(await ingestPdf(config, options, discovery, nextState));
      summaries.push(await ingestArticles(config, options, state, discovery, nextState));

      const sourceCount = await corpusStore.countSources(config);
      const degraded = summaries.some((summary) => summary.status === 'failed' || summary.failed > 0) || sourceCount === 0;

      return {
        summary: {
          sourceSummaries: summaries,
          degraded,
          corpusSourceCount: sourceCount
        },
        nextState
      };
    }
  };
};

const readArticleIndexHtml = async (options: {
  abortSignal?: AbortSignal | undefined;
  articleFetcher: ArticleFetcher;
  articleRawCache: ArticleRawCache;
  config: RuntimeConfig;
  forceReingest: boolean;
  reporter: ProgressReporter;
}): Promise<string> => {
  const { abortSignal, articleFetcher, articleRawCache, config, forceReingest, reporter } = options;
  throwIfAborted(abortSignal);
  try {
    reporter.info(`article: fetching Keith Baker index ${KEITH_BAKER_INDEX_URL}.`);
    const indexHtml = await articleFetcher.fetchText(KEITH_BAKER_INDEX_URL, { signal: abortSignal });
    throwIfAborted(abortSignal);
    await articleRawCache.write(config, KEITH_BAKER_INDEX_URL, indexHtml);
    return indexHtml;
  } catch (error) {
    if (!forceReingest) {
      throw error;
    }

    const cached = await articleRawCache.read(config, KEITH_BAKER_INDEX_URL);
    if (cached === null) {
      throw error;
    }

    reporter.warn(
      `article: live Keith Baker index fetch failed during force reingest; using cached index: ${formatThrownValue(error)}.`
    );
    return cached;
  }
};

const readArticleHtml = async (options: {
  abortSignal?: AbortSignal | undefined;
  article: ArticleStateRecord;
  articleFetcher: ArticleFetcher;
  articleRawCache: ArticleRawCache;
  config: RuntimeConfig;
  forceReingest: boolean;
  index: number;
  reporter: ProgressReporter;
  total: number;
}): Promise<string> => {
  const { abortSignal, article, articleFetcher, articleRawCache, config, forceReingest, index, reporter, total } = options;
  throwIfAborted(abortSignal);
  if (forceReingest && article.scrapeStatus === 'succeeded' && article.lastIngestedAt) {
    const cached = await articleRawCache.read(config, article.canonicalUrl);
    if (cached !== null) {
      reporter.info(`article: using cached raw HTML ${article.canonicalUrl} (${index + 1}/${total}).`);
      return cached;
    }
    reporter.info(`article: fetching cache miss ${article.canonicalUrl} (${index + 1}/${total}).`);
  } else {
    reporter.info(`article: fetching ${article.canonicalUrl} (${index + 1}/${total}).`);
  }

  const html = await articleFetcher.fetchText(article.canonicalUrl, { signal: abortSignal });
  throwIfAborted(abortSignal);
  await articleRawCache.write(config, article.canonicalUrl, html);
  return html;
};

const readScheduledFilenames = (details: string[]): string[] => details
    .filter((detail) => detail.startsWith('scheduled:'))
    .map((detail) => detail.slice('scheduled:'.length))
    .sort((a, b) => a.localeCompare(b));

const applyFoundryDeltaFile = async (
  corpusStore: CorpusStore,
  config: RuntimeConfig,
  deltaFile: FoundryDeltaFile,
  clearFoundry: boolean
): Promise<{ deleteCount: number; upsertCount: number }> => {
  const changes = deltaFile.operations.map((operation) =>
    operation.kind === 'delete'
      ? {
          kind: 'delete' as const,
          sourceKey: operation.recordId,
          sourceType: 'foundry' as const
        }
      : {
          kind: 'upsert' as const,
          chunks: operation.chunks,
          source: operation.source
        }
  );
  await corpusStore.applySourceChanges(config, {
    changes,
    ...(clearFoundry ? { clearSourceType: 'foundry' } : {})
  });
  return {
    deleteCount: deltaFile.operations.filter((operation) => operation.kind === 'delete').length,
    upsertCount: deltaFile.operations.filter((operation) => operation.kind === 'upsert').length
  };
};

const resetFoundryState = (state: RuntimeState): void => {
  state.foundry.appliedExportFilenames = [];
  state.foundry.lastSuccessfulExport = null;
};

const applyFoundryMarker = (state: RuntimeState, marker: FoundryDeltaFile['marker']): void => {
  state.foundry.appliedExportFilenames = [...new Set([...state.foundry.appliedExportFilenames, marker.filename])].sort((a, b) =>
    a.localeCompare(b)
  );
  if (!state.foundry.lastSuccessfulExport || marker.filename.localeCompare(state.foundry.lastSuccessfulExport.filename) >= 0) {
    state.foundry.lastSuccessfulExport = { ...marker };
  }
};

const skippedSummary = (sourceType: SourceIngestionSummary['sourceType'], message: string): SourceIngestionSummary => ({
    sourceType,
    status: 'skipped',
    discovered: 0,
    ingested: 0,
    removed: 0,
    failed: 0,
    message,
    details: []
  });

const succeededSummary = (
  sourceType: SourceIngestionSummary['sourceType'],
  discovered: number,
  ingested: number,
  removed: number,
  message: string,
  details: string[] = []
): SourceIngestionSummary => ({
    sourceType,
    status: 'succeeded',
    discovered,
    ingested,
    removed,
    failed: 0,
    message,
    details
  });

const failedSummary = (sourceType: SourceIngestionSummary['sourceType'], message: string): SourceIngestionSummary => ({
    sourceType,
    status: 'failed',
    discovered: 0,
    ingested: 0,
    removed: 0,
    failed: 1,
    message,
    details: []
  });

const cloneRuntimeState = (state: RuntimeState): RuntimeState => ({
    appVersion: state.appVersion,
    foundry: {
      appliedExportFilenames: [...state.foundry.appliedExportFilenames],
      lastSuccessfulExport: state.foundry.lastSuccessfulExport ? { ...state.foundry.lastSuccessfulExport } : null
    },
    pdf: {
      knownFilenames: [...state.pdf.knownFilenames]
    },
    article: {
      lastSuccessfulIndexScrapeAt: state.article.lastSuccessfulIndexScrapeAt,
      knownArticles: state.article.knownArticles.map((article) => ({ ...article }))
    }
  });

const sortArticles = (articles: ArticleStateRecord[]): ArticleStateRecord[] => articles.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
