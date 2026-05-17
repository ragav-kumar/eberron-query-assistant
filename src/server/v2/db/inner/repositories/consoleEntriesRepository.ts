import type Database from 'better-sqlite3';

import type { ConsoleEntry as StoredConsoleEntryRow } from '../schema.js';

export const createConsoleEntriesRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (id: string) => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT id, level, message, created_at
                    FROM console_entries
                    WHERE id = ?
                `)
                .get(id) as StoredConsoleEntryRow | undefined;
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare(`
                    SELECT id, level, message, created_at
                    FROM console_entries
                    ORDER BY created_at, id
                `)
                .all() as StoredConsoleEntryRow[];
        },
        save: async (entry: StoredConsoleEntryRow) => {
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
                .run(entry.id, entry.level, entry.message, entry.created_at);
        },
    });
