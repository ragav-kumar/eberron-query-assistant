import { mapSettingRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Setting as StoredSettingRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type SettingsRepository = V2Orm['settings'];

export const createSettingsRepository = ({ getDatabase }: RepositoryDependencies): SettingsRepository => {
    return {
        get: async (config, key) => {
            const database = await getDatabase(config);
            const row = database
                .prepare(`
                    SELECT key, value, modified_at
                    FROM settings
                    WHERE key = ?
                `)
                .get(key) as StoredSettingRow | undefined;
            return row ? mapSettingRow(row) : null;
        },
        list: async (config) => {
            const database = await getDatabase(config);
            const rows = database
                .prepare(`
                    SELECT key, value, modified_at
                    FROM settings
                    ORDER BY key ASC
                `)
                .all() as StoredSettingRow[];
            return rows.map(mapSettingRow);
        },
        save: async (config, setting) => {
            const database = await getDatabase(config);
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
    };
};
