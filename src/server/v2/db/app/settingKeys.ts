import { Kysely } from 'kysely';
import type { AppDatabaseSchema } from './schema.js';

export const settingKeys = {
    additionalContext: 'additional-context',
    articleLastSuccessfulIndexScrapeAt: 'article-last-successful-index-scrape-at',
    articleHtmlCacheDir: 'article-html-cache-dir',
    campaignJournalFolder: 'campaign-journal-folder',
    foundryLastSuccessfulExportDeleteCount: 'foundry-last-successful-export-delete-count',
    foundryLastSuccessfulExportFilename: 'foundry-last-successful-export-filename',
    foundryLastSuccessfulExportGeneratedAt: 'foundry-last-successful-export-generated-at',
    foundryLastSuccessfulExportRecordCount: 'foundry-last-successful-export-record-count',
    foundryLastSuccessfulExportRunId: 'foundry-last-successful-export-run-id',
    foundryLastSuccessfulExportSchemaVersion: 'foundry-last-successful-export-schema-version',
    foundryLastSuccessfulExportUpsertCount: 'foundry-last-successful-export-upsert-count',
    foundrySourceDir: 'foundry-source-dir',
    partyActorUuids: 'party-actor-uuids',
    pdfSourceDir: 'pdf-source-dir',
    providerApiKey: 'provider-api-key',
    providerBaseUrl: 'provider-base-url',
    providerChatModel: 'provider-chat-model',
    providerDebug: 'provider-debug',
    providerEmbeddingModel: 'provider-embedding-model',
    questsJournal: 'quests-journal',
    retrievalDir: 'retrieval-dir',
    sessionNotesJournal: 'session-notes-journal',
} as const;

export type SettingKey = (typeof settingKeys)[keyof typeof settingKeys];
export type SettingKeyName = keyof typeof settingKeys;

/**
 * Helpers for interacting with Settings. Intentionally does not parse types. You want that, you need something more robust.
 */
export const Settings = {
    read: async (db: Kysely<AppDatabaseSchema>, key: SettingKey): Promise<string | null> => db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', key)
        .executeTakeFirst()
        .then((row) => row?.value ?? null),

    readMany: async <T extends SettingKey>(
        db: Kysely<AppDatabaseSchema>,
        keys: readonly T[],
    ): Promise<Map<T, string>> => {
        if (keys.length === 0) {
            return new Map<T, string>();
        }

        const rows = await db
            .selectFrom('settings')
            .select(['key', 'value'])
            .where('key', 'in', [...keys])
            .execute();

        return new Map(rows.map((row) => [row.key as T, row.value]));
    },

    write: async (db: Kysely<AppDatabaseSchema>, key: SettingKey, value: string) => {
        const modifiedAt = new Date().toISOString();

        await db
            .insertInto('settings')
            .values({key, value, modifiedAt})
            .onConflict(conflict => conflict
                .column('key')
                .doUpdateSet({value, modifiedAt}),
            )
            .execute();
    },
};
