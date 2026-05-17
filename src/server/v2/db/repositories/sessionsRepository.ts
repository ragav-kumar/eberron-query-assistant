import { mapSessionRow, toTimestamp } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Session as StoredSessionRow } from '../schema.js';

import type { V2Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type SessionsRepository = V2Orm['sessions'];

export const createSessionsRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadRun' | 'loadSession' | 'loadSessionExchanges'>,
): SessionsRepository => {
    return {
        get: async (id, options) => {
            const database = await getDatabase();
            return loaders.loadSession(database, id, options);
        },
        list: async () => {
            const database = await getDatabase();
            const rows = database
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
                    ORDER BY created_at ASC, id ASC
                `)
                .all() as StoredSessionRow[];

            return rows.map((row) => {
                const exchanges = loaders.loadSessionExchanges(database, row.id);
                const activeRun = row.active_run_id ? loaders.loadRun(database, row.active_run_id) : null;
                return mapSessionRow(row, exchanges, activeRun);
            });
        },
        save: async session => {
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
                    session.activeRunId,
                    session.includePartyContext ? 1 : 0,
                    toTimestamp(session.archivedAt),
                    session.createdAt.toISOString(),
                    session.updatedAt.toISOString(),
                );
        },
    };
};
