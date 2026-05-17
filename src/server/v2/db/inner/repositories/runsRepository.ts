import type Database from 'better-sqlite3';

import type { Run as StoredRunRow } from '../schema.js';

export const createRunsRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (id: string) => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        exchange_id,
                        mode,
                        status,
                        prompt,
                        retrieval_turn_limit,
                        include_party_context,
                        error,
                        created_at,
                        updated_at,
                        started_at,
                        completed_at,
                        failed_at
                    FROM runs
                    WHERE id = ?
                `)
                .get(id) as StoredRunRow | undefined;
            return row ?? null;
        },
        listBySession: async (sessionId: string) => {
            const database = await getDatabase();
            return database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        exchange_id,
                        mode,
                        status,
                        prompt,
                        retrieval_turn_limit,
                        include_party_context,
                        error,
                        created_at,
                        updated_at,
                        started_at,
                        completed_at,
                        failed_at
                    FROM runs
                    WHERE session_id = ?
                    ORDER BY created_at, id
                `)
                .all(sessionId) as StoredRunRow[];
        },
        save: async (run: StoredRunRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO runs (
                        id,
                        session_id,
                        exchange_id,
                        mode,
                        status,
                        prompt,
                        retrieval_turn_limit,
                        include_party_context,
                        error,
                        created_at,
                        updated_at,
                        started_at,
                        completed_at,
                        failed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        session_id = excluded.session_id,
                        exchange_id = excluded.exchange_id,
                        mode = excluded.mode,
                        status = excluded.status,
                        prompt = excluded.prompt,
                        retrieval_turn_limit = excluded.retrieval_turn_limit,
                        include_party_context = excluded.include_party_context,
                        error = excluded.error,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at,
                        started_at = excluded.started_at,
                        completed_at = excluded.completed_at,
                        failed_at = excluded.failed_at
                `)
                .run(
                    run.id,
                    run.session_id,
                    run.exchange_id,
                    run.mode,
                    run.status,
                    run.prompt,
                    run.retrieval_turn_limit,
                    run.include_party_context,
                    run.error ?? null,
                    run.created_at,
                    run.updated_at,
                    run.started_at,
                    run.completed_at,
                    run.failed_at,
                );
        },
    });
