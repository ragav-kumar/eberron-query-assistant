import { Settings, settingKeys, type AppDb } from '@/server/v2/db/app/index.js';

import { defaults } from './defaults.js';

/**
 * Seeds missing persisted settings from defaults and environment variables.
 *
 * Paths are stored as repo-root-relative strings for portability. Provider
 * values may still fall back to env because they are often machine-local or
 * secret-backed.
 */
export const initializeSettings = async (appDb: AppDb, repoRoot = process.cwd()): Promise<void> => {
    const configuredDefaults = defaults.load(repoRoot);
    const current = await Settings.readMany(appDb.db, [
        settingKeys.articleHtmlCacheDir,
        settingKeys.foundrySourceDir,
        settingKeys.pdfSourceDir,
        settingKeys.providerApiKey,
        settingKeys.providerBaseUrl,
        settingKeys.providerChatModel,
        settingKeys.providerEmbeddingModel,
        settingKeys.retrievalDir,
    ]);

    await writeSettingIfMissing(appDb, current.get(settingKeys.articleHtmlCacheDir), settingKeys.articleHtmlCacheDir, configuredDefaults.paths.articleHtmlCacheDir);
    await writeSettingIfMissing(appDb, current.get(settingKeys.foundrySourceDir), settingKeys.foundrySourceDir, configuredDefaults.paths.foundrySourceDir);
    await writeSettingIfMissing(appDb, current.get(settingKeys.pdfSourceDir), settingKeys.pdfSourceDir, configuredDefaults.paths.pdfSourceDir);
    await writeSettingIfMissing(appDb, current.get(settingKeys.retrievalDir), settingKeys.retrievalDir, configuredDefaults.paths.retrievalDir);
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerApiKey),
        settingKeys.providerApiKey,
        configuredDefaults.provider.apiKey,
    );
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerBaseUrl),
        settingKeys.providerBaseUrl,
        configuredDefaults.provider.baseUrl,
    );
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerChatModel),
        settingKeys.providerChatModel,
        configuredDefaults.provider.chatModel,
    );
    await writeSettingIfMissing(
        appDb,
        current.get(settingKeys.providerEmbeddingModel),
        settingKeys.providerEmbeddingModel,
        configuredDefaults.provider.embeddingModel,
    );
};

const normalizeNullable = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
};

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
