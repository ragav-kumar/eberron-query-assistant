import type Database from 'better-sqlite3';

import type { Setting as StoredSettingRow } from '../schema.js';

export const createSettingsRepository = (getDatabase: () => Promise<Database.Database>) => ({
        get: async (key: string) => {
            const database = await getDatabase();
            const row = database
                .prepare<[string], StoredSettingRow>(`
                    SELECT key, value, modified_at
                    FROM settings
                    WHERE key = ?
                `)
                .get(key);
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare<[], StoredSettingRow>(`
                    SELECT key, value, modified_at
                    FROM settings
                    ORDER BY key
                `)
                .all();
        },
        save: async (setting: StoredSettingRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO settings (key, value, modified_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        modified_at = excluded.modified_at
                `)
                .run(setting.key, setting.value, setting.modified_at);
        },
    });
