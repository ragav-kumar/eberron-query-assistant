import type Database from 'better-sqlite3';

import type { Session as StoredSessionRow } from '../schema.js';

export const createSessionsRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (id: string) => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT
                        id,
                        mode,
                        title,
                        active_run_id,
                        include_party_context,
                        archived_at,
                        created_at,
                        updated_at
                    FROM sessions
                    WHERE id = ?
                `)
                .get(id) as StoredSessionRow | undefined;
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare(`
                    SELECT
                        id,
                        mode,
                        title,
                        active_run_id,
                        include_party_context,
                        archived_at,
                        created_at,
                        updated_at
                    FROM sessions
                    ORDER BY created_at, id
                `)
                .all() as StoredSessionRow[];
        },
        save: async (session: StoredSessionRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO sessions (
                        id,
                        mode,
                        title,
                        active_run_id,
                        include_party_context,
                        archived_at,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        mode = excluded.mode,
                        title = excluded.title,
                        active_run_id = excluded.active_run_id,
                        include_party_context = excluded.include_party_context,
                        archived_at = excluded.archived_at,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at
                `)
                .run(
                    session.id,
                    session.mode,
                    session.title ?? null,
                    session.active_run_id,
                    session.include_party_context,
                    session.archived_at,
                    session.created_at,
                    session.updated_at,
                );
        },
    });
