import { mapRunRow, toTimestamp } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Run as StoredRunRow } from '../schema.js';

import type { V2Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type RunsRepository = V2Orm['runs'];

export const createRunsRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadRun'>,
): RunsRepository => {
    return {
        get: async (id, options) => {
            const database = await getDatabase();
            return loaders.loadRun(database, id, options);
        },
        listBySession: async sessionId => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        include_party_context,
                        prompt,
                        retrieval_turn_limit,
                        kind,
                        status,
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
            return rows.map((row) => mapRunRow(row));
        },
        save: async run => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO runs (
                        id,
                        session_id,
                        include_party_context,
                        prompt,
                        retrieval_turn_limit,
                        kind,
                        status,
                        created_at,
                        updated_at,
                        started_at,
                        completed_at,
                        failed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        session_id = excluded.session_id,
                        include_party_context = excluded.include_party_context,
                        prompt = excluded.prompt,
                        retrieval_turn_limit = excluded.retrieval_turn_limit,
                        kind = excluded.kind,
                        status = excluded.status,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at,
                        started_at = excluded.started_at,
                        completed_at = excluded.completed_at,
                        failed_at = excluded.failed_at
                `)
                .run(
                    run.id,
                    run.sessionId,
                    run.includePartyContext ? 1 : 0,
                    run.prompt,
                    run.retrievalTurnLimit,
                    run.kind,
                    run.status,
                    run.createdAt.toISOString(),
                    run.updatedAt.toISOString(),
                    toTimestamp(run.startedAt),
                    toTimestamp(run.completedAt),
                    toTimestamp(run.failedAt),
                );
        },
    };
};
