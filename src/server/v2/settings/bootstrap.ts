import { AppDb, SettingKey, settingKeys, Settings } from '@/server/v2/db/app/index.js';
import { defaults, settingKeysToInitialize, settingsToInitialize } from './defaults.js';

/**
 * Seeds missing persisted settings from defaults and environment variables.
 */
export const initializeSettings = async (appDb: AppDb): Promise<void> => {
    const current = await Settings.readMany(appDb.db, settingsToInitialize);

    const writeSettingIfMissing = async (
        key: SettingKey,
        defaultValue: string | boolean | string[],
    ): Promise<void> => {
        const value = current.get(key);
        const trimmed = value?.trim();
        const normalized = trimmed && trimmed.length > 0 ? trimmed : null;

        if (normalized != null) {
            return;
        }

        await Settings.write(appDb.db, key, JSON.stringify(defaultValue));
    };

    for (const key of settingKeysToInitialize) {
        await writeSettingIfMissing(settingKeys[key], defaults[key]);
    }
};
