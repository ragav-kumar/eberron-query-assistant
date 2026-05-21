import type { IngestedArticle } from '@server/db/app/index.js';
import { settingsStore } from '@server/db/app/index.js';

import type { ArticleDiscoveryResult } from '../types.js';

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
    const refreshIntervalMs = settingsStore().read('articleIndexRefreshIntervalMs');
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
        shouldRefreshIndex: now.getTime() - lastScrapeTime >= refreshIntervalMs,
    };
};
