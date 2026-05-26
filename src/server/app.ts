import path from 'node:path';

import { AppDb, createAppDb, initializeSettingsStore, settingsStore } from './db/app/index.js';
import { createCorpusRetrievalService, createPartyContextService } from './db/corpus/index.js';
import {
    ConsoleEventPublisher,
    RefreshCoordinator,
    RunCoordinator,
    RuntimeEventPublisher,
    createConsoleEventPublisher,
    createRefreshCoordinator,
    createRunCoordinator,
    createStartupOrchestrator,
    createRuntimeEventPublisher,
    createRefreshVisibility,
} from './services/index.js';
import {
    createOpenAiChatAdapter,
    createOpenAiEmbeddingAdapter,
    ProviderConfig,
} from './services/provider/index.js';
import { createTaggedError } from '@/errors.js';

/**
 * This wraps the database lifecycle plus the process-local runtime
 * services that do not belong in SQLite itself.
 */
export interface AppContext extends AppDb {
    consoleEvents: ConsoleEventPublisher;
    refreshCoordinator: RefreshCoordinator;
    runCoordinator: RunCoordinator;
    runtimeEvents: RuntimeEventPublisher;
}

// noinspection JSUnusedGlobalSymbols
export interface CreateAppDependencies {
    repoRoot?: string;
}

// noinspection JSUnusedGlobalSymbols
export const createApp = async (dependencies: CreateAppDependencies = {}): Promise<AppContext> => {
    const repoRoot = dependencies.repoRoot ?? process.cwd();
    const appDb = await createAppDb();
    await initializeSettingsStore(appDb);
    const consoleEvents = createConsoleEventPublisher(appDb);
    const runtimeEvents = createRuntimeEventPublisher();
    const refreshCoordinator = createRefreshCoordinator(appDb, {
        visibility: createRefreshVisibility(consoleEvents, runtimeEvents),
    });
    const store = settingsStore();
    const retrievalDir = resolvePersistedRelativePath(repoRoot, store.read('retrievalDir'), 'retrievalDir');
    const providerConfig: ProviderConfig = {
        apiKey: store.read('providerApiKey'),
        baseUrl: store.read('providerBaseUrl'),
        chatModel: store.read('providerChatModel'),
        embeddingModel: store.read('providerEmbeddingModel'),
    };
    const retrieval = createCorpusRetrievalService({
        embeddingAdapter: createOpenAiEmbeddingAdapter(providerConfig),
        maxVectorCacheDatabaseBytes: store.read('retrievalMaxVectorCacheDatabaseBytes'),
        reporter: {
            info: (message) => {
                console.info(message);
            },
            warn: (message) => {
                console.warn(message);
            },
        },
    });
    const partyContext = createPartyContextService();
    const startupOrchestrator = createStartupOrchestrator(appDb, {
        consoleEvents,
        refreshCoordinator,
        runtimeEvents,
    });

    await startupOrchestrator.initialize();

    return {
        db: appDb.db,
        close: appDb.close,
        refreshCoordinator,
        runCoordinator: createRunCoordinator({
            appDb,
            chat: createOpenAiChatAdapter(providerConfig),
            partyContext,
            retrieval,
            retrievalDir,
            runtimeEvents,
        }),
        consoleEvents,
        runtimeEvents,
    };
};

const resolvePersistedRelativePath = (
    repoRoot: string,
    value: string,
    key: 'articleHtmlCacheDir' | 'foundrySourceDir' | 'pdfSourceDir' | 'retrievalDir',
): string => {
    if (path.isAbsolute(value)) {
        throw createTaggedError('invalid-settings-path', `Persisted setting "${key}" must be relative to the repo root.`);
    }
    return path.resolve(repoRoot, value);
};
