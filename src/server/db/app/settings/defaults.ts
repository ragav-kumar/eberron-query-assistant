import { z } from 'zod';
import { SettingKeyName } from './settingKeys.js';

const parseCommaSeparatedEnvList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string');
    }
    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
};

const parseBooleanEnv = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }

    return undefined;
};

export const settingKeysToInitialize = [
    'articleHtmlCacheDir',
    'articleIndexRefreshIntervalMs',
    'articleIndexUrl',
    'foundrySourceDir',
    'pdfSourceDir',
    'providerApiKey',
    'providerBaseUrl',
    'providerChatModel',
    'providerEmbeddingModel',
    'retrievalMaxEvidenceResults',
    'retrievalMaxToolTurns',
    'retrievalMaxVectorCacheDatabaseBytes',
    'retrievalDir',
    'questsJournal',
    'additionalContext',
    'campaignJournalFolder',
    'partyActorUuids',
    'consolePersist',
    'sessionNotesJournal'
] as const satisfies SettingKeyName[];

const envSchema = z.object({
    // Mandatory
    OPENAI_API_KEY: z.string().min(1),
    EQA_PARTY_ACTOR_UUIDS: z.preprocess(parseCommaSeparatedEnvList, z.array(z.string()).min(1)),

    // Optional
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    OPENAI_CHAT_MODEL: z.string().default('gpt-5.4-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EQA_APP_DB_PATH: z.string().default('.eberron-query-assistant/app.sqlite'),
    EQA_SESSION_NOTES_JOURNAL: z.string().default('Session Notes'),
    EQA_QUESTS_JOURNAL: z.string().default('Quests'),
    EQA_CAMPAIGN_JOURNAL_FOLDER: z.string().default('Legacy'),
    EQA_PROVIDER_DEBUG: z.preprocess(parseBooleanEnv, z.boolean()).default(false),
});

const env = Object.freeze(envSchema.parse(process.env));

export const defaults = Object.freeze({
    articleHtmlCacheDir: '.eberron-query-assistant/cache/keith-baker',
    articleIndexRefreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
    articleIndexUrl: 'https://keith-baker.com/eberron-index/',
    foundrySourceDir: 'foundry-export',
    pdfSourceDir: 'pdf',
    retrievalMaxEvidenceResults: 8,
    retrievalMaxToolTurns: 3,
    retrievalMaxVectorCacheDatabaseBytes: 256 * 1024 * 1024,
    retrievalDir: '.eberron-query-assistant/retrieval',

    providerApiKey: env.OPENAI_API_KEY,
    providerBaseUrl: env.OPENAI_BASE_URL,
    providerChatModel: env.OPENAI_CHAT_MODEL,
    providerEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,

    sessionNotesJournal: 'Session Notes',
    questsJournal: 'Quests',
    campaignJournalFolder: 'Legacy',
    consolePersist: env.EQA_PROVIDER_DEBUG,
    additionalContext: '',
    partyActorUuids: env.EQA_PARTY_ACTOR_UUIDS,

} satisfies Record<typeof settingKeysToInitialize[number], string | boolean | number | string[]>);

export const appDbPath = env.EQA_APP_DB_PATH;

/**
 * Host and port the API server binds to and the Vite dev proxy forwards to.
 * Hardcoded to loopback defaults; set EQA_V2_SERVER_HOST / EQA_V2_SERVER_PORT
 * in the environment to override without touching source.
 */
export const serverHost = process.env['EQA_SERVER_HOST'] ?? '127.0.0.1';
export const serverPort: number = (() => {
    const raw = process.env['EQA_SERVER_PORT'];
    if (raw == null) return 3001;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 3001;
})();
