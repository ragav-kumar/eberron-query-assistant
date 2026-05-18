import type Database from 'better-sqlite3';

import type { IngestedArticle as StoredIngestedArticleRow } from '../schema.js';

export const createIngestedArticlesRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (canonicalUrl: string) => {
            const database = await getDatabase();
            const row = database
                .prepare<[string], StoredIngestedArticleRow>(`
                    SELECT
                        canonical_url,
                        title,
                        first_seen_at,
                        last_ingested_at,
                        scrape_status
                    FROM ingested_articles
                    WHERE canonical_url = ?
                `)
                .get(canonicalUrl);
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare<[], StoredIngestedArticleRow>(`
                    SELECT
                        canonical_url,
                        title,
                        first_seen_at,
                        last_ingested_at,
                        scrape_status
                    FROM ingested_articles
                    ORDER BY canonical_url
                `)
                .all();
        },
        save: async (article: StoredIngestedArticleRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO ingested_articles (
                        canonical_url,
                        title,
                        first_seen_at,
                        last_ingested_at,
                        scrape_status
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(canonical_url) DO UPDATE SET
                        title = excluded.title,
                        last_ingested_at = excluded.last_ingested_at,
                        scrape_status = excluded.scrape_status
                `)
                .run(
                    article.canonical_url,
                    article.title,
                    article.first_seen_at,
                    article.last_ingested_at,
                    article.scrape_status,
                );
        },
    });
