import { mapSessionRow, toTimestamp } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Session as StoredSessionRow } from '../schema.js';

import type { V2Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type SessionsRepository = V2Orm['sessions'];

export const createSessionsRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadRun' | 'loadSession' | 'loadSessionEntries'>,
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
                        kind,
                        title,
                        active_run_id,
                        archived_at,
                        last_entry_at,
                        created_at,
                        updated_at
                    FROM sessions
                    ORDER BY created_at ASC, id ASC
                `)
                .all() as StoredSessionRow[];

            return rows.map((row) => {
                const entries = loaders.loadSessionEntries(database, row.id);
                const activeRun = row.active_run_id ? loaders.loadRun(database, row.active_run_id) : null;
                return mapSessionRow(row, entries, activeRun);
            });
        },
        save: async session => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO sessions (
                        id,
                        kind,
                        title,
                        active_run_id,
                        archived_at,
                        last_entry_at,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        kind = excluded.kind,
                        title = excluded.title,
                        active_run_id = excluded.active_run_id,
                        archived_at = excluded.archived_at,
                        last_entry_at = excluded.last_entry_at,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at
                `)
                .run(
                    session.id,
                    session.kind,
                    session.title ?? null,
                    session.activeRunId ?? null,
                    toTimestamp(session.archivedAt),
                    toTimestamp(session.lastEntryAt),
                    session.createdAt.toISOString(),
                    session.updatedAt.toISOString(),
                );
        },
    };
};
