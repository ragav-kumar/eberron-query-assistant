import { mapConsoleEntryRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { ConsoleEntry as StoredConsoleEntryRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type ConsoleEntriesRepository = V2Orm['consoleEntries'];

export const createConsoleEntriesRepository = (
    { getDatabase }: RepositoryDependencies,
): ConsoleEntriesRepository => {
    return {
        get: async id => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT id, level, message, created_at
                    FROM console_entries
                    WHERE id = ?
                `)
                .get(id) as StoredConsoleEntryRow | undefined;
            return row ? mapConsoleEntryRow(row) : null;
        },
        list: async () => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    SELECT id, level, message, created_at
                    FROM console_entries
                    ORDER BY created_at ASC, id ASC
                `)
                .all() as StoredConsoleEntryRow[];
            return rows.map(mapConsoleEntryRow);
        },
        save: async entry => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO console_entries (id, level, message, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        level = excluded.level,
                        message = excluded.message,
                        created_at = excluded.created_at
                `)
                .run(entry.id, entry.level, entry.message, entry.createdAt.toISOString());
        },
    };
};
