import { SettingKeyName } from './settingKeys.js';
import { Settings } from './settingsStore.js';

export const parseSetting = <K extends SettingKeyName>(key: K, stringValue: string): Settings[K] => {
    switch (key) {
        case 'articleLastSuccessfulIndexScrapeAt':
        case 'foundryLastSuccessfulExportGeneratedAt':
            return new Date(stringValue) as Settings[K];

        case 'foundryLastSuccessfulExportDeleteCount':
        case 'foundryLastSuccessfulExportRecordCount':
        case 'foundryLastSuccessfulExportUpsertCount':
            return Number.parseInt(stringValue, 10) as Settings[K];

        case 'partyActorUuids':
            return JSON.parse(stringValue) as Settings[K];

        case 'providerDebug':
            return (stringValue === 'true') as Settings[K];

        default:
            return stringValue as Settings[K];
    }
};

export const assignSetting = <K extends SettingKeyName>(
    target: Partial<Settings>,
    key: K,
    value: Settings[K],
): void => {
    target[key] = value;
};