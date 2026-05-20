import { z } from 'zod';
import { SettingKeyName, settingKeys } from '../db/app/index.js';

export const settingKeysToInitialize = [
    'articleHtmlCacheDir',
    'foundrySourceDir',
    'pdfSourceDir',
    'providerApiKey',
    'providerBaseUrl',
    'providerChatModel',
    'providerEmbeddingModel',
    'retrievalDir',
    'questsJournal',
    'additionalContext',
    'campaignJournalFolder',
    'partyActorUuids',
    'providerDebug',
    'sessionNotesJournal'
] as const satisfies SettingKeyName[];
export const settingsToInitialize = settingKeysToInitialize.map(key => settingKeys[key]);

const envSchema = z.object({
    // Mandatory
    OPENAI_API_KEY: z.string().min(1),
    EQA_PARTY_ACTOR_UUIDS: z.array(z.string()),

    // Optional
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    OPENAI_CHAT_MODEL: z.string().default('gpt-5.4-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EQA_APP_DB_PATH: z.string().default('.eberron-query-assistant/app.sqlite'),
    EQA_SESSION_NOTES_JOURNAL: z.string().default('Session Notes'),
    EQA_QUESTS_JOURNAL: z.string().default('Quests'),
    EQA_CAMPAIGN_JOURNAL_FOLDER: z.string().default('Legacy'),
    EQA_PROVIDER_DEBUG: z.boolean().default(false),
});

const env = Object.freeze(envSchema.parse(process.env));

export const defaults = Object.freeze({
    articleHtmlCacheDir: '.eberron-query-assistant/cache/keith-baker',
    foundrySourceDir: 'foundry-export',
    pdfSourceDir: 'pdf',
    retrievalDir: '.eberron-query-assistant/retrieval',

    providerApiKey: env.OPENAI_API_KEY,
    providerBaseUrl: env.OPENAI_BASE_URL,
    providerChatModel: env.OPENAI_CHAT_MODEL,
    providerEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,

    sessionNotesJournal: 'Session Notes',
    questsJournal: 'Quests',
    campaignJournalFolder: 'Legacy',
    providerDebug: env.EQA_PROVIDER_DEBUG,
    additionalContext: '',
    partyActorUuids: env.EQA_PARTY_ACTOR_UUIDS,

} satisfies Record<typeof settingKeysToInitialize[number], string | boolean | string[]>);