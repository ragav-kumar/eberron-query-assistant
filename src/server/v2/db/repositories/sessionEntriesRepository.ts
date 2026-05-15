import { mapSessionEntryRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { SessionEntry as StoredSessionEntryRow } from '../schema.js';

import type { V2Loaders } from '../loaders.js';
import type { RepositoryDependencies } from './shared.js';

type SessionEntriesRepository = V2Orm['sessionEntries'];

export const createSessionEntriesRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadNpcsByRun' | 'loadSessionEntries'>,
): SessionEntriesRepository => {
    return {
        get: async (sessionId, entryIndex) => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT
                        session_id,
                        entry_index,
                        run_id,
                        title,
                        kind,
                        content,
                        created_at
                    FROM session_entries
                    WHERE session_id = ? AND entry_index = ?
                `)
                .get(sessionId, entryIndex) as StoredSessionEntryRow | undefined;
            if (!row) {
                return null;
            }

            const npcs = row.run_id ? loaders.loadNpcsByRun(database, row.run_id) : [];
            return mapSessionEntryRow(row, npcs);
        },
        listBySession: async sessionId => {
            const database = await getDatabase();
            return loaders.loadSessionEntries(database, sessionId);
        },
        save: async entry => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO session_entries (
                        session_id,
                        entry_index,
                        run_id,
                        title,
                        kind,
                        content,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id, entry_index) DO UPDATE SET
                        run_id = excluded.run_id,
                        title = excluded.title,
                        kind = excluded.kind,
                        content = excluded.content,
                        created_at = excluded.created_at
                `)
                .run(
                    entry.sessionId,
                    entry.entryIndex,
                    entry.runId ?? null,
                    entry.title ?? null,
                    entry.kind,
                    'content' in entry ? entry.content : null,
                    entry.createdAt.toISOString(),
                );
        },
    };
};
