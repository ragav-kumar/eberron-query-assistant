export const settingKeys = {
    additionalContext: 'additional-context',
    articleLastSuccessfulIndexScrapeAt: 'article-last-successful-index-scrape-at',
    campaignJournalFolder: 'campaign-journal-folder',
    foundryLastSuccessfulExportDeleteCount: 'foundry-last-successful-export-delete-count',
    foundryLastSuccessfulExportFilename: 'foundry-last-successful-export-filename',
    foundryLastSuccessfulExportGeneratedAt: 'foundry-last-successful-export-generated-at',
    foundryLastSuccessfulExportRecordCount: 'foundry-last-successful-export-record-count',
    foundryLastSuccessfulExportRunId: 'foundry-last-successful-export-run-id',
    foundryLastSuccessfulExportSchemaVersion: 'foundry-last-successful-export-schema-version',
    foundryLastSuccessfulExportUpsertCount: 'foundry-last-successful-export-upsert-count',
    partyActorUuids: 'party-actor-uuids',
    providerApiKey: 'provider-api-key',
    providerBaseUrl: 'provider-base-url',
    providerChatModel: 'provider-chat-model',
    providerDebug: 'provider-debug',
    providerEmbeddingModel: 'provider-embedding-model',
    questsJournal: 'quests-journal',
    sessionNotesJournal: 'session-notes-journal',
} as const;

export type SettingKey = (typeof settingKeys)[keyof typeof settingKeys];
