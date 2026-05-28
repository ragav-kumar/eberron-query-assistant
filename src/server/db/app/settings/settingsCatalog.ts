import { SettingKeyName } from './settingKeys.js';

/**
 * Shape of one entry in the settings catalog — the static metadata for a
 * single setting, without a current value.
 *
 * `key` is typed as SettingKeyName so the route handler can pass it directly
 * to settingsStore().read() / .write() without casting.
 *
 * Entries with `settingType: 'readonly'` are app state exposed for debugging.
 * The PUT handler rejects writes to them with 405.
 */
export type SettingCatalogEntry =
    | { key: SettingKeyName; settingType: 'string';   label: string; section: string; description?: string; placeholder?: string }
    | { key: SettingKeyName; settingType: 'password';  label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'number';   label: string; section: string; description?: string; min?: number; max?: number }
    | { key: SettingKeyName; settingType: 'boolean';  label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'textarea'; label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'array';    label: string; section: string; description?: string }
    | { key: SettingKeyName; settingType: 'url';      label: string; section: string; description?: string; placeholder?: string }
    | { key: SettingKeyName; settingType: 'path';     label: string; section: string; description?: string; placeholder?: string }
    | { key: SettingKeyName; settingType: 'readonly'; label: string; section: string; description?: string };

/**
 * Ordered list of all settings exposed through `GET /api/v2/settings`.
 * The UI groups entries by `section` and renders them in catalog order.
 *
 * Every key in settingKeys is represented here. Keys that track app state
 * (ingestion timestamps, export counts, etc.) use settingType 'readonly'
 * so the UI can display them for debugging without allowing writes.
 */
export const settingsCatalog = [
    // ── Provider ─────────────────────────────────────────────────────────────
    {
        key: 'providerApiKey',
        settingType: 'password',
        label: 'API Key',
        section: 'Provider',
        description: 'OpenAI-compatible API key used for chat and embedding requests.',
    },
    {
        key: 'providerBaseUrl',
        settingType: 'url',
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

    // ── Party Context ─────────────────────────────────────────────────────────
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

    // ── Source Directories ────────────────────────────────────────────────────
    {
        key: 'foundrySourceDir',
        settingType: 'path',
        label: 'Foundry Export Directory',
        section: 'Source Directories',
        description: 'Path to the directory containing Foundry VTT export files.',
        placeholder: 'foundry-export',
    },
    {
        key: 'pdfSourceDir',
        settingType: 'path',
        label: 'PDF Directory',
        section: 'Source Directories',
        description: 'Path to the directory containing PDF source documents.',
        placeholder: 'pdf',
    },

    // ── Retrieval ─────────────────────────────────────────────────────────────
    {
        key: 'retrievalDir',
        settingType: 'path',
        label: 'Retrieval Artifacts Directory',
        section: 'Retrieval',
        description: 'Path where retrieval indexes and vector cache files are stored.',
        placeholder: '.eberron-query-assistant/retrieval',
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
        key: 'retrievalMaxVectorCacheDatabaseBytes',
        settingType: 'number',
        label: 'Vector Cache Size (bytes)',
        section: 'Retrieval',
        description: 'Maximum size of the in-process vector cache database in bytes.',
        min: 1,
    },

    // ── Article Index ─────────────────────────────────────────────────────────
    {
        key: 'articleIndexUrl',
        settingType: 'url',
        label: 'Article Index URL',
        section: 'Article Index',
        description: 'URL of the Keith Baker article index page used to discover articles.',
        placeholder: 'https://keith-baker.com/eberron-index/',
    },
    {
        key: 'articleIndexRefreshIntervalMs',
        settingType: 'number',
        label: 'Index Refresh Interval (ms)',
        section: 'Article Index',
        description: 'How often the article index is re-scraped, in milliseconds.',
        min: 1,
    },
    {
        key: 'articleHtmlCacheDir',
        settingType: 'path',
        label: 'Article HTML Cache Directory',
        section: 'Article Index',
        description: 'Path where downloaded article HTML files are cached.',
        placeholder: '.eberron-query-assistant/cache/keith-baker',
    },
    {
        key: 'articleLastSuccessfulIndexScrapeAt',
        settingType: 'readonly',
        label: 'Last Successful Index Scrape',
        section: 'Article Index',
        description: 'Timestamp of the most recent successful article index scrape.',
    },

    // ── Foundry Export State ──────────────────────────────────────────────────
    {
        key: 'foundryLastSuccessfulExportFilename',
        settingType: 'readonly',
        label: 'Last Export Filename',
        section: 'Foundry Export State',
        description: 'Filename of the most recently ingested Foundry export.',
    },
    {
        key: 'foundryLastSuccessfulExportGeneratedAt',
        settingType: 'readonly',
        label: 'Last Export Generated At',
        section: 'Foundry Export State',
        description: 'Timestamp embedded in the most recently ingested Foundry export.',
    },
    {
        key: 'foundryLastSuccessfulExportRunId',
        settingType: 'readonly',
        label: 'Last Export Run ID',
        section: 'Foundry Export State',
        description: 'Run ID of the most recently ingested Foundry export.',
    },
    {
        key: 'foundryLastSuccessfulExportSchemaVersion',
        settingType: 'readonly',
        label: 'Last Export Schema Version',
        section: 'Foundry Export State',
        description: 'Schema version of the most recently ingested Foundry export.',
    },
    {
        key: 'foundryLastSuccessfulExportRecordCount',
        settingType: 'readonly',
        label: 'Last Export Record Count',
        section: 'Foundry Export State',
        description: 'Number of records in the most recently ingested Foundry export.',
    },
    {
        key: 'foundryLastSuccessfulExportUpsertCount',
        settingType: 'readonly',
        label: 'Last Export Upsert Count',
        section: 'Foundry Export State',
        description: 'Number of records upserted during the most recent Foundry ingestion.',
    },
    {
        key: 'foundryLastSuccessfulExportDeleteCount',
        settingType: 'readonly',
        label: 'Last Export Delete Count',
        section: 'Foundry Export State',
        description: 'Number of records deleted during the most recent Foundry ingestion.',
    },

    // ── Diagnostic ────────────────────────────────────────────────────────────
    {
        key: 'consolePersist',
        settingType: 'boolean',
        label: 'Persist Console Output',
        section: 'Diagnostic',
        description: 'Write all console entries to the database so they survive process restarts.',
    },

    // ── Additional Context ────────────────────────────────────────────────────
    {
        key: 'additionalContext',
        settingType: 'textarea',
        label: 'Additional Context',
        section: 'Additional Context',
        description: 'Local prompt guidance included in all assistant work. Not retrieved from corpus and not cited as a source.',
    },
] as const satisfies readonly SettingCatalogEntry[];

/** Keys of all settings in the catalog, used to validate PUT/GET requests. */
export const settingsCatalogKeys: ReadonlySet<SettingKeyName> = new Set(
    settingsCatalog.map(e => e.key),
);

// noinspection JSUnusedLocalSymbols
/**
 * Do not delete.
 * Compile-time exhaustiveness guard. Evaluates to `true` when every
 * SettingKeyName appears in the catalog; becomes `never` (type error) if any
 * key is added to settingKeys without a matching catalog entry.
 */
const _catalogCoversAllSettingKeys: [SettingKeyName] extends [typeof settingsCatalog[number]['key']] ? true : never = true;
