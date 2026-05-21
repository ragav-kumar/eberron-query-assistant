import type { IngestedArticle } from '@server/db/app/index.js';

import type { ArticleDiscoveryResult } from '../types.js';

const ARTICLE_INDEX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decides whether the remote article index should be scraped during this run.
 *
 * The article source is periodic rather than file-backed, so refresh uses the
 * last successful index scrape time to avoid refetching the index every run.
 */
export const discoverArticleRefresh = (
    currentArticles: IngestedArticle[],
    lastSuccessfulIndexScrapeAt: string | null,
    forceReingest: boolean,
    now: Date,
): ArticleDiscoveryResult => {
    if (forceReingest) {
        return {
            currentArticles,
            shouldRefreshIndex: true,
        };
    }

    if (!lastSuccessfulIndexScrapeAt) {
        return {
            currentArticles,
            shouldRefreshIndex: true,
        };
    }

    const lastScrapeTime = Date.parse(lastSuccessfulIndexScrapeAt);
    if (Number.isNaN(lastScrapeTime)) {
        return {
            currentArticles,
            shouldRefreshIndex: true,
        };
    }

    return {
        currentArticles,
        shouldRefreshIndex: now.getTime() - lastScrapeTime >= ARTICLE_INDEX_INTERVAL_MS,
    };
};
