import { ADDITIONAL_CONTEXT_KEY, mapSettingRow } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Setting as StoredSettingRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type SettingsRepository = V2Orm['settings'];

export const createSettingsRepository = ({ getDatabase }: RepositoryDependencies): SettingsRepository => {
    return {
        getAdditionalContext: async () => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    SELECT key, value, modified_at
                    FROM settings
                    WHERE key = ?
                `)
                .get(ADDITIONAL_CONTEXT_KEY) as StoredSettingRow | undefined;
            return row ? mapSettingRow(row) : null;
        },
        saveAdditionalContext: async document => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO settings (key, value, modified_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        modified_at = excluded.modified_at
                `)
                .run(ADDITIONAL_CONTEXT_KEY, document.markdown, document.updatedAt.toISOString());
        },
    };
};
