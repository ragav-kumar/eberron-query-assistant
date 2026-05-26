import { SettingKeyName } from './settingKeys.js';
import { Settings } from './settingsStore.js';

export const parseSetting = <K extends SettingKeyName>(key: K, stringValue: string): Settings[K] => {
    switch (key) {
        case 'articleLastSuccessfulIndexScrapeAt':
        case 'foundryLastSuccessfulExportGeneratedAt':
            return new Date(stringValue) as Settings[K];

        case 'articleIndexRefreshIntervalMs':
        case 'foundryLastSuccessfulExportDeleteCount':
        case 'foundryLastSuccessfulExportRecordCount':
        case 'foundryLastSuccessfulExportUpsertCount':
        case 'retrievalMaxEvidenceResults':
        case 'retrievalMaxToolTurns':
        case 'retrievalMaxVectorCacheDatabaseBytes':
            return Number.parseInt(stringValue, 10) as Settings[K];

        case 'partyActorUuids':
            return JSON.parse(stringValue) as Settings[K];

        case 'consolePersist':
            return (stringValue === 'true') as Settings[K];

        default:
            return stringValue as Settings[K];
    }
};

export const serializeSetting = <K extends SettingKeyName>(key: K, value: Settings[K]): string => {
    switch (key) {
        case 'articleLastSuccessfulIndexScrapeAt':
        case 'foundryLastSuccessfulExportGeneratedAt':
            return (value as Date).toISOString();

        case 'articleIndexRefreshIntervalMs':
        case 'foundryLastSuccessfulExportDeleteCount':
        case 'foundryLastSuccessfulExportRecordCount':
        case 'foundryLastSuccessfulExportUpsertCount':
        case 'retrievalMaxEvidenceResults':
        case 'retrievalMaxToolTurns':
        case 'retrievalMaxVectorCacheDatabaseBytes':
            return String(value);

        case 'partyActorUuids':
            return JSON.stringify(value);

        case 'consolePersist':
            return value ? 'true' : 'false';

        default:
            return String(value);
    }
};

export const assignSetting = <K extends SettingKeyName>(
    target: Partial<Settings>,
    key: K,
    value: Settings[K],
): void => {
    target[key] = value;
};
