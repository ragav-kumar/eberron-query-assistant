import { SettingKeyName, settingKeys, SettingsHelper } from './settingKeys.js';
import { AppDb } from '../db.js';
import { defaults, settingKeysToInitialize } from './defaults.js';
import { assignSetting, parseSetting } from './helpers.js';

interface TypedSettings {
    articleLastSuccessfulIndexScrapeAt: Date;
    foundryLastSuccessfulExportDeleteCount: number;
    foundryLastSuccessfulExportGeneratedAt: Date;
    foundryLastSuccessfulExportRecordCount: number;
    foundryLastSuccessfulExportUpsertCount: number;
    partyActorUuids: string[];
    providerDebug: boolean;
}

export type Settings = {
    [K in SettingKeyName]: K extends keyof TypedSettings ? TypedSettings[K] : string;
};

let settingsData: Settings | undefined = undefined;

interface SettingsStore {
    read: <T extends SettingKeyName>(key: T) => Settings[T];
    write: <T extends SettingKeyName>(appDb: AppDb, key: T, value: Settings[T]) => Promise<void>;
}

export const initializeSettingsStore = async (appDb: AppDb) => {
    const insertIfMissing = async <T>(key: SettingKeyName) => {
        if (!Object.hasOwnProperty.call(defaults, key)) {
            return;
        }
        const dbKey = settingKeys[key];
        const existing = await SettingsHelper.read(appDb.db, dbKey);
        if (existing != null) {
            return;
        }
        const defaultValue = defaults[key as keyof typeof defaults] as T;

        await SettingsHelper.write(appDb.db, dbKey, JSON.stringify(defaultValue));
    };

    for (const settingKey of settingKeysToInitialize) {
        await insertIfMissing(settingKey);
    }

    const settingsStrings = await SettingsHelper.readMany(appDb.db, settingKeysToInitialize);

    const partialSettings: Partial<Settings> = {};
    for (const { key, stringValue } of settingsStrings) {
        assignSetting(partialSettings, key, parseSetting(key, stringValue));
    }
    settingsData = partialSettings as Settings;
};

export const settingsStore = (): SettingsStore => {
    if (settingsData == null) {
        throw new Error('Settings not initialized');
    }

    const writeSetting = async <T extends SettingKeyName>(appDb: AppDb, key: T, value: Settings[T]) => {
        // write value
        const dbKey = settingKeys[key];
        await SettingsHelper.write(appDb.db, dbKey, JSON.stringify(value));

        // Update value in settingData
        settingsData![key] = value;
    };

    return {
        read: key => settingsData![key],
        write: writeSetting,
    };
};

