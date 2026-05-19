import type { IngestedArticle } from '@/server/v2/db/app/index.js';

import type { ArticleDiscoveryResult } from '../types.js';

const ARTICLE_INDEX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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
