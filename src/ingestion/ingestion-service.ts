import type { ProgressReporter } from "../progress/reporter.js";
import type { SourceDiscoverySummary } from "../source-discovery/index.js";
import type { ArticleStateRecord, RuntimeState } from "../state/index.js";
import type { IngestionSummary, RuntimeConfig, RuntimeOptions, SourceIngestionSummary } from "../types.js";
import { FetchArticleFetcher, KEITH_BAKER_INDEX_URL, type ArticleFetcher, discoverArticleLinks, normalizeArticle } from "./article-ingestion.js";
import type { CorpusStore } from "./corpus-store.js";
import { parseFoundryRecords } from "./foundry-ingestion.js";
import { PdfDataExtractParser, type PdfParser, normalizePdf } from "./pdf-ingestion.js";

export interface IngestionServiceDependencies {
  articleFetcher?: ArticleFetcher;
  corpusStore: CorpusStore;
  now?: () => Date;
  pdfParser?: PdfParser;
  reporter: ProgressReporter;
}

export interface IngestionService {
  ingest(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary,
    invalidated?: boolean
  ): Promise<{
    summary: IngestionSummary;
    nextState: RuntimeState;
  }>;
}

export class FilesystemIngestionService implements IngestionService {
  private readonly articleFetcher: ArticleFetcher;
  private readonly corpusStore: CorpusStore;
  private readonly now: () => Date;
  private readonly pdfParser: PdfParser;

  constructor(dependencies: IngestionServiceDependencies) {
    this.articleFetcher = dependencies.articleFetcher ?? new FetchArticleFetcher();
    this.corpusStore = dependencies.corpusStore;
    this.now = dependencies.now ?? (() => new Date());
    this.pdfParser = dependencies.pdfParser ?? new PdfDataExtractParser();
  }

  async ingest(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary,
    invalidated = false
  ): Promise<{
    summary: IngestionSummary;
    nextState: RuntimeState;
  }> {
    await this.corpusStore.initialize(config);
    if (options.forceReingest || invalidated) {
      await this.corpusStore.clear(config);
    }

    const nextState = cloneRuntimeState(state);
    const summaries: SourceIngestionSummary[] = [];

    summaries.push(await this.ingestFoundry(config, discovery, nextState));
    summaries.push(await this.ingestPdf(config, discovery, nextState));
    summaries.push(await this.ingestArticles(config, options, state, discovery, nextState));

    const sourceCount = await this.corpusStore.countSources(config);
    const degraded = summaries.some((summary) => summary.status === "failed" || summary.failed > 0) || sourceCount === 0;

    return {
      summary: {
        sourceSummaries: summaries,
        degraded,
        corpusSourceCount: sourceCount
      },
      nextState
    };
  }

  private async ingestFoundry(
    config: RuntimeConfig,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === "foundry");
    if (!inventory || inventory.status !== "scheduled") {
      return skippedSummary("foundry", "foundry: ingestion skipped.");
    }

    const marker = discovery.nextState.foundry.lastSuccessfulExport;
    if (!marker) {
      return failedSummary("foundry", "foundry: scheduled without a manifest marker.");
    }

    try {
      const parsed = await parseFoundryRecords(config, marker);
      await this.corpusStore.replaceSourcesByType(config, "foundry", parsed.sources);
      nextState.foundry.lastSuccessfulExport = marker;
      return succeededSummary("foundry", parsed.sources.length, parsed.sources.length, 0, "foundry: ingested records.ndjson.");
    } catch (error) {
      return failedSummary("foundry", `foundry: ingestion failed: ${formatError(error)}.`);
    }
  }

  private async ingestPdf(
    config: RuntimeConfig,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === "pdf");
    if (!inventory || inventory.status !== "scheduled") {
      return skippedSummary("pdf", "pdf: ingestion skipped.");
    }

    const added = inventory.details
      .filter((detail) => detail.startsWith("added:"))
      .map((detail) => detail.slice("added:".length));
    const removed = inventory.details
      .filter((detail) => detail.startsWith("removed:"))
      .map((detail) => detail.slice("removed:".length));
    const filenames = inventory.added > 0 && added.length === 0 ? discovery.nextState.pdf.knownFilenames : added;

    let ingested = 0;
    let failed = 0;
    const details: string[] = [];

    for (const filename of removed) {
      await this.corpusStore.removeSource(config, "pdf", filename);
    }

    for (const filename of filenames) {
      try {
        const normalized = await normalizePdf(config, filename, this.pdfParser);
        await this.corpusStore.replaceSource(config, normalized.source, normalized.chunks);
        ingested += 1;
      } catch (error) {
        failed += 1;
        details.push(`${filename}: ${formatError(error)}`);
      }
    }

    if (failed === 0) {
      nextState.pdf.knownFilenames = [...discovery.nextState.pdf.knownFilenames];
      return succeededSummary("pdf", inventory.discovered, ingested, removed.length, "pdf: ingested inventory changes.", details);
    }

    return {
      sourceType: "pdf",
      status: ingested > 0 || removed.length > 0 ? "succeeded" : "failed",
      discovered: inventory.discovered,
      ingested,
      removed: removed.length,
      failed,
      message:
        ingested > 0 || removed.length > 0
          ? "pdf: ingestion completed with source-scoped failures."
          : "pdf: ingestion failed.",
      details
    };
  }

  private async ingestArticles(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    discovery: SourceDiscoverySummary,
    nextState: RuntimeState
  ): Promise<SourceIngestionSummary> {
    const inventory = discovery.inventories.find((candidate) => candidate.sourceType === "article");
    if (!inventory || inventory.status !== "scheduled") {
      return skippedSummary("article", "article: ingestion skipped.");
    }

    const now = this.now().toISOString();
    try {
      const indexHtml = await this.articleFetcher.fetchText(KEITH_BAKER_INDEX_URL);
      const discovered = discoverArticleLinks(indexHtml, state.article.knownArticles, now);
      const articleMap = new Map(discovered.articles.map((article) => [article.canonicalUrl, article]));
      const ingestCandidates = discovered.articles.filter(
        (article) => options.forceReingest || article.scrapeStatus !== "succeeded" || !article.lastIngestedAt
      );

      let ingested = 0;
      let failed = 0;
      const details: string[] = [];

      for (const article of ingestCandidates) {
        try {
          const html = await this.articleFetcher.fetchText(article.canonicalUrl);
          const normalized = normalizeArticle(article.canonicalUrl, html, article, now);
          await this.corpusStore.replaceSource(config, normalized.source, normalized.chunks);
          articleMap.set(article.canonicalUrl, normalized.article);
          ingested += 1;
        } catch (error) {
          failed += 1;
          details.push(`${article.canonicalUrl}: ${formatError(error)}`);
          articleMap.set(article.canonicalUrl, {
            ...article,
            scrapeStatus: "failed"
          });
        }
      }

      nextState.article.lastSuccessfulIndexScrapeAt = now;
      nextState.article.knownArticles = sortArticles([...articleMap.values()]);

      return {
        sourceType: "article",
        status: failed > 0 && ingested === 0 ? "failed" : "succeeded",
        discovered: discovered.discoveredUrls.length,
        ingested,
        removed: 0,
        failed,
        message:
          failed > 0
            ? "article: ingestion completed with source-scoped failures."
            : "article: discovered and ingested article changes.",
        details
      };
    } catch (error) {
      return failedSummary("article", `article: ingestion failed: ${formatError(error)}.`);
    }
  }
}

function skippedSummary(sourceType: SourceIngestionSummary["sourceType"], message: string): SourceIngestionSummary {
  return {
    sourceType,
    status: "skipped",
    discovered: 0,
    ingested: 0,
    removed: 0,
    failed: 0,
    message,
    details: []
  };
}

function succeededSummary(
  sourceType: SourceIngestionSummary["sourceType"],
  discovered: number,
  ingested: number,
  removed: number,
  message: string,
  details: string[] = []
): SourceIngestionSummary {
  return {
    sourceType,
    status: "succeeded",
    discovered,
    ingested,
    removed,
    failed: 0,
    message,
    details
  };
}

function failedSummary(sourceType: SourceIngestionSummary["sourceType"], message: string): SourceIngestionSummary {
  return {
    sourceType,
    status: "failed",
    discovered: 0,
    ingested: 0,
    removed: 0,
    failed: 1,
    message,
    details: []
  };
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    appVersion: state.appVersion,
    foundry: {
      lastSuccessfulExport: state.foundry.lastSuccessfulExport ? { ...state.foundry.lastSuccessfulExport } : null
    },
    pdf: {
      knownFilenames: [...state.pdf.knownFilenames]
    },
    article: {
      lastSuccessfulIndexScrapeAt: state.article.lastSuccessfulIndexScrapeAt,
      knownArticles: state.article.knownArticles.map((article) => ({ ...article }))
    }
  };
}

function sortArticles(articles: ArticleStateRecord[]): ArticleStateRecord[] {
  return articles.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
