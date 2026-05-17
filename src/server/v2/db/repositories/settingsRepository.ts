import { mapSettingRow } from '../mappers.js';
import type { Orm } from '../contract.js';
import type { Setting as StoredSettingRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type SettingsRepository = Orm['settings'];

export const createSettingsRepository = ({ getDatabase }: RepositoryDependencies): SettingsRepository => ({
        get: async key => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT key, value, modified_at
                    FROM settings
                    WHERE key = ?
                `)
                .get(key) as StoredSettingRow | undefined;
            return row ? mapSettingRow(row) : null;
        },
        list: async () => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    SELECT key, value, modified_at
                    FROM settings
                    ORDER BY key ASC
                `)
                .all() as StoredSettingRow[];
            return rows.map(mapSettingRow);
        },
        save: async setting => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO settings (key, value, modified_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        modified_at = excluded.modified_at
                `)
                .run(setting.key, setting.value, setting.modifiedAt.toISOString());
        },
    });
