import { mapSettingRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { StoredSettingRow } from '../storedRows.js';

import type { RepositoryDependencies } from './shared.js';

type SettingsRepository = V2Orm['settings'];

export const createSettingsRepository = ({ getDatabase }: RepositoryDependencies): SettingsRepository => {
    return {
        async get(config, key) {
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
        async list(config) {
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
        async save(config, setting) {
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
