import type Database from 'better-sqlite3';

import type { RefreshState as StoredRefreshStateRow } from '../schema.js';

const SINGLETON_KEY = 1;

export const createRefreshStateRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async () => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT
                        singleton_key,
                        active_operation,
                        refresh_status,
                        reingest_status,
                        last_refresh_at,
                        last_reingest_at,
                        created_at,
                        updated_at
                    FROM refresh_state
                    WHERE singleton_key = ?
                `)
                .get(SINGLETON_KEY) as StoredRefreshStateRow | undefined;
            return row ?? null;
        },
        save: async (refreshState: StoredRefreshStateRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO refresh_state (
                        singleton_key,
                        active_operation,
                        refresh_status,
                        reingest_status,
                        last_refresh_at,
                        last_reingest_at,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(singleton_key) DO UPDATE SET
                        active_operation = excluded.active_operation,
                        refresh_status = excluded.refresh_status,
                        reingest_status = excluded.reingest_status,
                        last_refresh_at = excluded.last_refresh_at,
                        last_reingest_at = excluded.last_reingest_at,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at
                `)
                .run(
                    SINGLETON_KEY,
                    refreshState.active_operation,
                    refreshState.refresh_status,
                    refreshState.reingest_status,
                    refreshState.last_refresh_at,
                    refreshState.last_reingest_at,
                    refreshState.created_at,
                    refreshState.updated_at,
                );
        },
    });
