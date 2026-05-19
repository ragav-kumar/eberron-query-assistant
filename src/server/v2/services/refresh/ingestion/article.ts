import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';

import { createTaggedError } from '@/errors.js';
import type { IngestedArticle } from '@/server/v2/db/app/index.js';
import type { CorpusChunk, CorpusSource } from '@/types.js';

import type { SourceChangeSet } from '../types.js';
import { chunkText, normalizeText } from './chunking.js';

/**
 * Canonical index page used to discover Keith Baker article URLs.
 */
export const KEITH_BAKER_INDEX_URL = 'https://keith-baker.com/eberron-index/';

const FETCH_TIMEOUT_MS = 30_000;
const PERMANENTLY_INACCESSIBLE_STATUSES = new Set([403, 404]);

export interface ArticleFetcher {
    fetchText(url: string, options?: { signal?: AbortSignal | undefined }): Promise<string>;
}

/**
 * Structured error returned when an article fetch fails at the HTTP layer.
 */
export interface HttpFetchFailedError {
    kind: 'http-fetch-failed';
    message: string;
    name: string;
    status: number;
    statusText: string;
    url: string;
}

/**
 * Default network-backed article fetcher used by refresh.
 *
 * Timeout and abort wiring live here so the ingestion logic can focus on the
 * source-specific rules around indexing and normalization.
 */
export const createFetchArticleFetcher = (): ArticleFetcher => ({
    fetchText: async (url, options = {}) => {
        const abortController = new AbortController();
        const abortFromCaller = (): void => {
            abortController.abort();
        };
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        if (options.signal?.aborted) {
            abortController.abort();
        }
        const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

        let response: Response;
        try {
            response = await fetch(url, { signal: abortController.signal });
        } finally {
            options.signal?.removeEventListener('abort', abortFromCaller);
            clearTimeout(timeout);
        }

        if (!response.ok) {
            throw {
                kind: 'http-fetch-failed',
                message: `GET ${url} failed with ${response.status} ${response.statusText}`,
                name: 'http-fetch-failed',
                status: response.status,
                statusText: response.statusText,
                url,
            } satisfies HttpFetchFailedError;
        }

        return response.text();
    },
});

/**
 * Scrapes the article index when required, then ingests any articles that are
 * new, previously failed, or being force reingested.
 */
export const buildArticleRefresh = async (options: {
    abortSignal?: AbortSignal;
    currentArticles: IngestedArticle[];
    fetcher: ArticleFetcher;
    forceReingest: boolean;
    now: string;
    shouldRefreshIndex: boolean;
}): Promise<{
    articleRows: IngestedArticle[];
    changeSet: SourceChangeSet;
}> => {
    const byUrl = new Map(options.currentArticles.map(article => [article.canonicalUrl, article]));
    if (!options.shouldRefreshIndex) {
        return {
            articleRows: [...byUrl.values()].sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl)),
            changeSet: {
                changes: [],
            },
        };
    }

    const indexHtml = await options.fetcher.fetchText(KEITH_BAKER_INDEX_URL, { signal: options.abortSignal });
    const discovered = discoverArticleLinks(indexHtml, [...byUrl.values()], options.now);
    const candidates = options.forceReingest
        ? discovered.articles
        : discovered.articles.filter(article => article.scrapeStatus !== 'succeeded' || !article.lastIngestedAt);
    const changes: SourceChangeSet['changes'] = [];

    for (const article of candidates) {
        try {
            const html = await options.fetcher.fetchText(article.canonicalUrl, { signal: options.abortSignal });
            const normalized = normalizeArticle(article.canonicalUrl, html, byUrl.get(article.canonicalUrl) ?? null, options.now);
            byUrl.set(normalized.article.canonicalUrl, normalized.article);
            changes.push({
                kind: 'upsert',
                chunks: normalized.chunks,
                source: normalized.source,
            });
        } catch (error) {
            if (isPermanentlyInaccessibleArticleFetch(error)) {
                byUrl.set(article.canonicalUrl, {
                    ...article,
                    scrapeStatus: 'inaccessible',
                });
                continue;
            }

            throw createTaggedError('article-ingestion-failed', `Failed to ingest ${article.canonicalUrl}: ${String((error as Error)?.message ?? error)}`);
        }
    }

    return {
        articleRows: [...byUrl.values()].sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl)),
        changeSet: {
            ...(options.forceReingest ? { clearSourceType: 'article' as const } : {}),
            changes,
        },
    };
};

const isPermanentlyInaccessibleArticleFetch = (value: unknown): value is HttpFetchFailedError => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<HttpFetchFailedError>;
    return candidate.kind === 'http-fetch-failed' && typeof candidate.status === 'number' && PERMANENTLY_INACCESSIBLE_STATUSES.has(candidate.status);
};

/**
 * Extracts canonical article URLs from the index page and merges them with the
 * currently tracked article rows.
 */
const discoverArticleLinks = (
    indexHtml: string,
    previousArticles: IngestedArticle[],
    now: string,
): {
    articles: IngestedArticle[];
    discoveredUrls: string[];
} => {
    const $ = cheerio.load(indexHtml);
    const content = $('main, article, .entry-content, #content').first();
    const root = content.length > 0 ? content : $('body');
    const previous = new Map(previousArticles.map(article => [article.canonicalUrl, article]));
    const discoveredUrls = [
        ...new Set(
            root
                .find('a[href]')
                .toArray()
                .map(element => canonicalArticleUrl($(element).attr('href')))
                .filter((url): url is string => url !== null),
        ),
    ].sort((left, right) => left.localeCompare(right));

    const articles = new Map(previous);
    for (const url of discoveredUrls) {
        if (!articles.has(url)) {
            articles.set(url, {
                canonicalUrl: url,
                firstSeenAt: now,
                lastIngestedAt: null,
                scrapeStatus: 'pending',
                title: null,
            });
        }
    }

    return {
        articles: [...articles.values()].sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl)),
        discoveredUrls,
    };
};

/**
 * Normalizes a fetched article HTML page into one corpus source plus chunked
 * body text, and returns the updated tracked article row.
 */
const normalizeArticle = (
    url: string,
    html: string,
    previous: IngestedArticle | null,
    now: string,
): {
    article: IngestedArticle;
    chunks: CorpusChunk[];
    source: CorpusSource;
} => {
    const $ = cheerio.load(html);
    const articleElement = $('article, main, .entry-content, #content').first();
    const root = articleElement.length > 0 ? articleElement : $('body');
    root.find('script, style, nav, footer, form, noscript').remove();

    const title =
        normalizeText($('.entry-title').first().text())
        || normalizeText($('article h1, main h1').first().text())
        || normalizeText($('meta[property="og:title"]').attr('content') ?? '')
        || normalizeText($('h1').first().text())
        || normalizeTitleElement($('title').first().text())
        || previous?.title
        || url;
    const headings = root
        .find('h2, h3')
        .toArray()
        .map(element => normalizeText($(element).text()))
        .filter(heading => heading.length > 0);
    const bodyText = normalizeText(
        root
            .find('p, li, h2, h3, blockquote')
            .toArray()
            .map(element => normalizeText($(element).text()))
            .filter(text => text.length > 0)
            .join('\n\n'),
    );

    const sourceKey = url;
    const sourceId = `article:${hashText(sourceKey)}`;
    const contentHash = hashText(bodyText);
    const source: CorpusSource = {
        metadata: {
            contentHash,
            headings,
            sourceType: 'article',
            title,
            url,
        },
        sourceId,
        sourceKey,
        sourceType: 'article',
        status: 'succeeded',
        title,
    };

    const chunks = chunkText(bodyText).map((chunk, chunkIndex): CorpusChunk => ({
        chunkId: `${sourceId}:chunk:${chunkIndex}`,
        chunkIndex,
        citation: {
            label: title,
            locator: null,
            sourceType: 'article',
            url,
        },
        metadata: {
            endParagraph: chunk.endParagraph,
            headings,
            sourceType: 'article',
            startParagraph: chunk.startParagraph,
            title,
            url,
        },
        sourceId,
        text: chunk.text,
    }));

    return {
        article: {
            canonicalUrl: url,
            firstSeenAt: previous?.firstSeenAt ?? now,
            lastIngestedAt: now,
            scrapeStatus: 'succeeded',
            title,
        },
        chunks,
        source,
    };
};

/**
 * Restricts discovered links to the canonical Keith Baker domain and strips
 * query/hash fragments so article rows stay stable across runs.
 */
const canonicalArticleUrl = (href: string | undefined): string | null => {
    if (!href) {
        return null;
    }

    let url: URL;
    try {
        url = new URL(href, KEITH_BAKER_INDEX_URL);
    } catch {
        return null;
    }

    if (url.hostname !== 'keith-baker.com') {
        return null;
    }

    url.hash = '';
    url.search = '';
    const value = url.toString();
    if (value === KEITH_BAKER_INDEX_URL || !value.startsWith('https://keith-baker.com/')) {
        return null;
    }
    return value;
};

const normalizeTitleElement = (title: string): string => normalizeText(title)
    .replace(/\s*[-|]\s*Keith Baker'?s Blog$/i, '')
    .replace(/\s*[-|]\s*Keith Baker.*$/i, '')
    .trim();

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 24);
