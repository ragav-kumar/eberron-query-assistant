import path from 'node:path';

import { createTaggedError } from '@/errors.js';
import { Settings, settingKeys, type AppDb } from '@/server/v2/db/app/index.js';
import { defaults } from './defaults.js';

export interface RuntimePaths {
    articleHtmlCacheDir: string;
    foundryExportDir: string;
    pdfDir: string;
    repoRoot: string;
    retrievalDir: string;
}

export interface EmbeddingProviderSettings {
    apiKey: string | null;
    baseUrl: string;
    embeddingModel: string;
}

export interface ChatProviderSettings {
    apiKey: string | null;
    baseUrl: string;
    chatModel: string;
}

/**
 * Resolves runtime directories from persisted app settings.
 */
export const resolveRuntimePaths = async (appDb: AppDb, repoRoot = process.cwd()): Promise<RuntimePaths> => {
    const configuredDefaults = defaults.load(repoRoot);
    const values = await Settings.readMany(appDb.db, [
        settingKeys.articleHtmlCacheDir,
        settingKeys.foundrySourceDir,
        settingKeys.pdfSourceDir,
        settingKeys.retrievalDir,
    ]);

    return {
        articleHtmlCacheDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.articleHtmlCacheDir) ?? configuredDefaults.paths.articleHtmlCacheDir,
        ),
        foundryExportDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.foundrySourceDir) ?? configuredDefaults.paths.foundrySourceDir,
        ),
        pdfDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.pdfSourceDir) ?? configuredDefaults.paths.pdfSourceDir,
        ),
        repoRoot,
        retrievalDir: resolveRepoRelativePath(
            repoRoot,
            values.get(settingKeys.retrievalDir) ?? configuredDefaults.paths.retrievalDir,
        ),
    };
};

/**
 * Reads provider settings used for embedding-backed retrieval refresh.
 */
export const readEmbeddingProviderSettings = async (appDb: AppDb, repoRoot = process.cwd()): Promise<EmbeddingProviderSettings> => {
    const configuredDefaults = defaults.load(repoRoot);
    const values = await Settings.readMany(appDb.db, [
        settingKeys.providerApiKey,
        settingKeys.providerBaseUrl,
        settingKeys.providerEmbeddingModel,
    ]);

    const apiKey = normalizeNullable(values.get(settingKeys.providerApiKey))
        ?? configuredDefaults.provider.apiKey;
    const baseUrl = normalizeBaseUrl(
        normalizeNullable(values.get(settingKeys.providerBaseUrl))
        ?? configuredDefaults.provider.baseUrl,
    );
    const embeddingModel = normalizeNullable(values.get(settingKeys.providerEmbeddingModel))
        ?? configuredDefaults.provider.embeddingModel;

    return {
        apiKey,
        baseUrl,
        embeddingModel,
    };
};

/**
 * Reads provider settings used for interactive chat runs.
 */
export const readChatProviderSettings = async (appDb: AppDb, repoRoot = process.cwd()): Promise<ChatProviderSettings> => {
    const configuredDefaults = defaults.load(repoRoot);
    const values = await Settings.readMany(appDb.db, [
        settingKeys.providerApiKey,
        settingKeys.providerBaseUrl,
        settingKeys.providerChatModel,
    ]);

    const apiKey = normalizeNullable(values.get(settingKeys.providerApiKey))
        ?? configuredDefaults.provider.apiKey;
    const baseUrl = normalizeBaseUrl(
        normalizeNullable(values.get(settingKeys.providerBaseUrl))
        ?? configuredDefaults.provider.baseUrl,
    );
    const chatModel = normalizeNullable(values.get(settingKeys.providerChatModel))
        ?? configuredDefaults.provider.chatModel;

    return {
        apiKey,
        baseUrl,
        chatModel,
    };
};

const normalizeNullable = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const resolveRepoRelativePath = (repoRoot: string, configuredPath: string): string => {
    if (path.isAbsolute(configuredPath)) {
        throw createTaggedError(
            'invalid-settings-path',
            `Configured settings paths must be repo-root-relative, but received absolute path: ${configuredPath}`,
        );
    }

    return path.resolve(repoRoot, configuredPath);
};
