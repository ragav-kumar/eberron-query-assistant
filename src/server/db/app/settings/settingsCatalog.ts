import { SettingKeyName } from './settingKeys.js';

/**
 * Shape of one entry in the settings catalog — the static metadata for a
 * single user-configurable setting, without a current value.
 *
 * `key` is typed as SettingKeyName so the route handler can pass it directly
 * to settingsStore().read() / .write() without casting.
 */
export type SettingCatalogEntry =
    | { key: SettingKeyName; settingType: 'string';   label: string; section: string; description?: string; placeholder?: string }
    | { key: SettingKeyName; settingType: 'password';  label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'number';   label: string; section: string; description?: string; min?: number; max?: number }
    | { key: SettingKeyName; settingType: 'boolean';  label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'textarea'; label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'array';    label: string; section: string; description?: string };

/**
 * Ordered list of all settings exposed through `GET /api/v2/settings`.
 * The UI groups entries by `section` and renders them in catalog order.
 * Internal state keys (foundry export state, article scrape timestamps, etc.)
 * are intentionally excluded — they are not user-configurable.
 */
export const settingsCatalog: readonly SettingCatalogEntry[] = [
    {
        key: 'providerApiKey',
        settingType: 'password',
        label: 'API Key',
        section: 'Provider',
        description: 'OpenAI-compatible API key used for chat and embedding requests.',
    },
    {
        key: 'providerBaseUrl',
        settingType: 'string',
        label: 'Base URL',
        section: 'Provider',
        description: 'Provider base address. Defaults to the OpenAI API.',
        placeholder: 'https://api.openai.com/v1',
    },
    {
        key: 'providerChatModel',
        settingType: 'string',
        label: 'Chat Model',
        section: 'Provider',
        description: 'Model used for assistant and NPC responses.',
    },
    {
        key: 'providerEmbeddingModel',
        settingType: 'string',
        label: 'Embedding Model',
        section: 'Provider',
        description: 'Model used to generate retrieval embeddings.',
    },
    {
        key: 'partyActorUuids',
        settingType: 'array',
        label: 'Party Actor UUIDs',
        section: 'Party Context',
        description: 'Foundry actor UUIDs for the active party, one per line.',
    },
    {
        key: 'sessionNotesJournal',
        settingType: 'string',
        label: 'Session Notes Journal',
        section: 'Party Context',
        description: 'Name of the Foundry journal that records session notes.',
    },
    {
        key: 'questsJournal',
        settingType: 'string',
        label: 'Quests Journal',
        section: 'Party Context',
        description: 'Name of the Foundry journal that tracks quest threads.',
    },
    {
        key: 'campaignJournalFolder',
        settingType: 'string',
        label: 'Campaign Journal Folder',
        section: 'Party Context',
        description: 'Foundry folder name that groups campaign journals.',
    },
    {
        key: 'retrievalMaxEvidenceResults',
        settingType: 'number',
        label: 'Max Evidence Results',
        section: 'Retrieval',
        description: 'Maximum number of retrieved evidence passages per query.',
        min: 1,
    },
    {
        key: 'retrievalMaxToolTurns',
        settingType: 'number',
        label: 'Max Tool Turns',
        section: 'Retrieval',
        description: 'Maximum number of retrieval tool calls allowed per run.',
        min: 0,
    },
    {
        key: 'consolePersist',
        settingType: 'boolean',
        label: 'Persist Console Output',
        section: 'Diagnostic',
        description: 'Write all console entries to the database so they survive process restarts.',
    },
    {
        key: 'additionalContext',
        settingType: 'textarea',
        label: 'Additional Context',
        section: 'Additional Context',
        description: 'Local prompt guidance included in all assistant work. Not retrieved from corpus and not cited as a source.',
    },
] as const;

/** Keys of settings exposed through the API, used to validate PUT requests. */
export const settingsCatalogKeys: ReadonlySet<SettingKeyName> = new Set(
    settingsCatalog.map(e => e.key),
);
