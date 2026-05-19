import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Settings, settingKeys, type AppDb } from '@/server/v2/db/app/index.js';

import type { RefreshProviderSettings, RefreshRuntimePaths } from './types.js';

const DEFAULT_ARTICLE_HTML_CACHE_DIR = '.eberron-query-assistant/cache/keith-baker';
const DEFAULT_FOUNDRY_EXPORT_DIR = 'foundry-export';
const DEFAULT_PDF_DIR = 'pdf';
const DEFAULT_PROVIDER_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_PROVIDER_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_RETRIEVAL_DIR = '.eberron-query-assistant/retrieval';
const OPENAI_API_KEY_ENV_KEY = 'OPENAI_API_KEY';
const OPENAI_BASE_URL_ENV_KEY = 'OPENAI_BASE_URL';
const OPENAI_EMBEDDING_MODEL_ENV_KEY = 'OPENAI_EMBEDDING_MODEL';

export const initializeRefreshSettings = async (appDb: AppDb, repoRoot = process.cwd()): Promise<void> => {
    const env = parseEnvFile(path.join(repoRoot, '.env'));
    const current = await Settings.readMany(appDb.db, [
        settingKeys.articleHtmlCacheDir,
        settingKeys.foundrySourceDir,
        settingKeys.pdfSourceDir,
        settingKeys.providerApiKey,
        settingKeys.providerBaseUrl,
        settingKeys.providerEmbeddingModel,
        settingKeys.retrievalDir,
    ]);

    await writeSettingIfMissing(appDb, current.get(settingKeys.articleHtmlCacheDir), settingKeys.articleHtmlCacheDir, DEFAULT_ARTICLE_HTML_CACHE_DIR);
    await writeSettingIfMissing(appDb, current.get(settingKeys.foundrySourceDir), settingKeys.foundrySourceDir, DEFAULT_FOUNDRY_EXPORT_DIR);
    await writeSettingIfMissing(appDb, current.get(settingKeys.pdfSourceDir), settingKeys.pdfSourceDir, DEFAULT_PDF_DIR);
    await writeSettingIfMissing(appDb, current.get(settingKeys.retrievalDir), settingKeys.retrievalDir, DEFAULT_RETRIEVAL_DIR);
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerApiKey),
        settingKeys.providerApiKey,
        readEnvValue(OPENAI_API_KEY_ENV_KEY, env) ?? null,
    );
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerBaseUrl),
        settingKeys.providerBaseUrl,
        normalizeBaseUrl(readEnvValue(OPENAI_BASE_URL_ENV_KEY, env) ?? DEFAULT_PROVIDER_BASE_URL),
    );
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerEmbeddingModel),
        settingKeys.providerEmbeddingModel,
        readEnvValue(OPENAI_EMBEDDING_MODEL_ENV_KEY, env) ?? DEFAULT_PROVIDER_EMBEDDING_MODEL,
    );
};

export const resolveRefreshRuntimePaths = async (appDb: AppDb, repoRoot = process.cwd()): Promise<RefreshRuntimePaths> => {
    const values = await Settings.readMany(appDb.db, [
        settingKeys.articleHtmlCacheDir,
        settingKeys.foundrySourceDir,
        settingKeys.pdfSourceDir,
        settingKeys.retrievalDir,
    ]);

    return {
        articleHtmlCacheDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.articleHtmlCacheDir) ?? DEFAULT_ARTICLE_HTML_CACHE_DIR,
        ),
        foundryExportDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.foundrySourceDir) ?? DEFAULT_FOUNDRY_EXPORT_DIR,
        ),
        pdfDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.pdfSourceDir) ?? DEFAULT_PDF_DIR,
        ),
        repoRoot,
        retrievalDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.retrievalDir) ?? DEFAULT_RETRIEVAL_DIR,
        ),
    };
};

export const readRefreshProviderSettings = async (appDb: AppDb, repoRoot = process.cwd()): Promise<RefreshProviderSettings> => {
    const env = parseEnvFile(path.join(repoRoot, '.env'));
    const values = await Settings.readMany(appDb.db, [
        settingKeys.providerApiKey,
        settingKeys.providerBaseUrl,
        settingKeys.providerEmbeddingModel,
    ]);

    const apiKey = normalizeNullable(values.get(settingKeys.providerApiKey))
        ?? normalizeNullable(readEnvValue(OPENAI_API_KEY_ENV_KEY, env));
    const baseUrl = normalizeBaseUrl(
        normalizeNullable(values.get(settingKeys.providerBaseUrl))
        ?? normalizeNullable(readEnvValue(OPENAI_BASE_URL_ENV_KEY, env))
        ?? DEFAULT_PROVIDER_BASE_URL,
    );
    const embeddingModel = normalizeNullable(values.get(settingKeys.providerEmbeddingModel))
        ?? normalizeNullable(readEnvValue(OPENAI_EMBEDDING_MODEL_ENV_KEY, env))
        ?? DEFAULT_PROVIDER_EMBEDDING_MODEL;

    return {
        apiKey,
        baseUrl,
        embeddingModel,
    };
};

const normalizeNullable = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const writeSettingIfMissing = async (
    appDb: AppDb,
    currentValue: string | undefined,
    key: typeof settingKeys[keyof typeof settingKeys],
    nextValue: string | null,
): Promise<void> => {
    if (normalizeNullable(currentValue) != null || nextValue == null) {
        return;
    }

    await Settings.write(appDb.db, key, nextValue);
};

const resolveRepoRelativePath = (repoRoot: string, configuredPath: string): string => (
    path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(repoRoot, configuredPath)
);

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
