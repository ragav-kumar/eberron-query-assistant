import { mapRunRow, toTimestamp } from '../mappers.js';
import type { Orm } from '../contract.js';
import type { Run as StoredRunRow } from '../schema.js';

import type { Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type RunsRepository = Orm['runs'];

export const createRunsRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<Loaders, 'loadRun'>,
): RunsRepository => ({
        get: async id => {
            const database = await getDatabase();
            return loaders.loadRun(database, id);
        },
        listBySession: async sessionId => {
            const database = await getDatabase();
            const rows = database
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
                    ORDER BY created_at ASC, id ASC
                `)
                .all(sessionId) as StoredRunRow[];
            return rows.map(mapRunRow);
        },
        save: async run => {
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
                    run.sessionId,
                    run.exchangeId,
                    run.mode,
                    run.status,
                    run.prompt,
                    run.retrievalTurnLimit,
                    run.includePartyContext ? 1 : 0,
                    run.error ?? null,
                    run.createdAt.toISOString(),
                    run.updatedAt.toISOString(),
                    toTimestamp(run.startedAt),
                    toTimestamp(run.completedAt),
                    toTimestamp(run.failedAt),
                );
        },
    });
