import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface LoadedDefaults {
    paths: {
        articleHtmlCacheDir: string;
        foundrySourceDir: string;
        pdfSourceDir: string;
        retrievalDir: string;
    };
    provider: {
        apiKey: string | null;
        baseUrl: string;
        chatModel: string;
        embeddingModel: string;
    };
}

const settings = {
    defaults: {
        articleHtmlCacheDir: '.eberron-query-assistant/cache/keith-baker',
        foundrySourceDir: 'foundry-export',
        pdfSourceDir: 'pdf',
        providerBaseUrl: 'https://api.openai.com/v1',
        providerChatModel: 'gpt-5.4-mini',
        providerEmbeddingModel: 'text-embedding-3-small',
        retrievalDir: '.eberron-query-assistant/retrieval',
    },
    envKeys: {
        providerApiKey: 'OPENAI_API_KEY',
        providerBaseUrl: 'OPENAI_BASE_URL',
        providerChatModel: 'OPENAI_CHAT_MODEL',
        providerEmbeddingModel: 'OPENAI_EMBEDDING_MODEL',
    },
} as const;

const cache = new Map<string, LoadedDefaults>();

/**
 * Shared startup/runtime defaults resolved once per repo root from `.env`,
 * process env, and hardcoded fallbacks.
 */
export const defaults = Object.freeze({
    load: (repoRoot = process.cwd()): LoadedDefaults => {
        const normalizedRepoRoot = path.resolve(repoRoot);
        const cached = cache.get(normalizedRepoRoot);
        if (cached) {
            return cached;
        }

        const env = parseEnvFile(path.join(normalizedRepoRoot, '.env'));
        const loaded: LoadedDefaults = Object.freeze({
            paths: Object.freeze({
                articleHtmlCacheDir: settings.defaults.articleHtmlCacheDir,
                foundrySourceDir: settings.defaults.foundrySourceDir,
                pdfSourceDir: settings.defaults.pdfSourceDir,
                retrievalDir: settings.defaults.retrievalDir,
            }),
            provider: Object.freeze({
                apiKey: normalizeNullable(readEnvValue(settings.envKeys.providerApiKey, env)),
                baseUrl: normalizeBaseUrl(
                    readEnvValue(settings.envKeys.providerBaseUrl, env) ?? settings.defaults.providerBaseUrl,
                ),
                chatModel: readEnvValue(settings.envKeys.providerChatModel, env) ?? settings.defaults.providerChatModel,
                embeddingModel: readEnvValue(settings.envKeys.providerEmbeddingModel, env) ?? settings.defaults.providerEmbeddingModel,
            }),
        });

        cache.set(normalizedRepoRoot, loaded);
        return loaded;
    },
}) satisfies Readonly<{
    load(repoRoot?: string): LoadedDefaults;
}>;

const normalizeNullable = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const readEnvValue = (key: string, envFile: Record<string, string>): string | undefined => {
    const value = process.env[key] ?? envFile[key];
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
};

const parseEnvFile = (envPath: string): Record<string, string> => {
    if (!existsSync(envPath)) {
        return {};
    }

    const entries: Record<string, string> = {};
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        entries[key] = unwrapEnvValue(rawValue);
    }

    return entries;
};

const unwrapEnvValue = (value: string): string => {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
};
