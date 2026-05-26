import { SettingKeyName, settingKeyNames, settingKeys, SettingsHelper } from './settingKeys.js';
import { AppDb } from '../db.js';
import { defaults } from './defaults.js';
import { assignSetting, parseSetting, serializeSetting } from './helpers.js';

interface TypedSettings {
    articleLastSuccessfulIndexScrapeAt: Date | undefined;
    articleIndexRefreshIntervalMs: number;
    articleIndexUrl: string;
    foundryLastSuccessfulExportDeleteCount: number | undefined;
    foundryLastSuccessfulExportFilename: string | undefined;
    foundryLastSuccessfulExportGeneratedAt: Date | undefined;
    foundryLastSuccessfulExportRecordCount: number | undefined;
    foundryLastSuccessfulExportRunId: string | undefined;
    foundryLastSuccessfulExportSchemaVersion: string | undefined;
    foundryLastSuccessfulExportUpsertCount: number | undefined;

    partyActorUuids: string[];
    consolePersist: boolean;
    retrievalMaxEvidenceResults: number;
    retrievalMaxToolTurns: number;
    retrievalMaxVectorCacheDatabaseBytes: number;
}

const optionalSettingDefaults = {
    articleLastSuccessfulIndexScrapeAt: undefined,
    foundryLastSuccessfulExportDeleteCount: undefined,
    foundryLastSuccessfulExportFilename: undefined,
    foundryLastSuccessfulExportGeneratedAt: undefined,
    foundryLastSuccessfulExportRecordCount: undefined,
    foundryLastSuccessfulExportRunId: undefined,
    foundryLastSuccessfulExportSchemaVersion: undefined,
    foundryLastSuccessfulExportUpsertCount: undefined,
} as const;

export type Settings = {
    [K in SettingKeyName]: K extends keyof TypedSettings ? TypedSettings[K] : string;
};

let settingsData: Settings | undefined = undefined;

interface SettingsStore {
    read: <T extends SettingKeyName>(key: T) => Settings[T];
    write: <T extends SettingKeyName>(appDb: AppDb, key: T, value: Settings[T]) => Promise<void>;
}

export const initializeSettingsStore = async (appDb: AppDb) => {
    const insertIfMissing = async (key: SettingKeyName) => {
        if (Object.hasOwnProperty.call(optionalSettingDefaults, key)) {
            return;
        }

        if (!Object.hasOwnProperty.call(defaults, key)) {
            return;
        }
        const dbKey = settingKeys[key];
        const existing = await SettingsHelper.read(appDb.db, dbKey);
        if (existing != null) {
            return;
        }
        const defaultValue = defaults[key as keyof typeof defaults] as Settings[typeof key];

        await SettingsHelper.write(appDb.db, dbKey, serializeSetting(key, defaultValue));
    };

    for (const settingKey of Object.keys(settingKeys) as SettingKeyName[]) {
        await insertIfMissing(settingKey);
    }

    const settingsStrings = await SettingsHelper.readMany(appDb.db, settingKeyNames);

    const hydrated = {
        ...defaults,
        ...optionalSettingDefaults,
    };

    for (const {key, stringValue} of settingsStrings) {
        assignSetting(hydrated, key, parseSetting(key, stringValue));
    }
    settingsData = hydrated;
};

export const settingsStore = (): SettingsStore => {
    if (settingsData == null) {
        throw new Error('Settings not initialized');
    }

    const writeSetting = async <T extends SettingKeyName>(appDb: AppDb, key: T, value: Settings[T]) => {
        // write value
        const dbKey = settingKeys[key];
        await SettingsHelper.write(appDb.db, dbKey, serializeSetting(key, value));

        // Update value in settingData
        settingsData![key] = value;
    };

    return {
        read: key => settingsData![key],
        write: writeSetting,
    };
};

