import { createAppDb, resolveAppDatabasePath } from './db/app/index.js';
import { createCorpusRetrievalService, createPartyContextService } from './db/corpus/index.js';
import {
    readChatProviderSettings,
    readEmbeddingProviderSettings,
    resolveRuntimePaths,
} from './settings/index.js';
import {
    createConsoleEventPublisher,
    createRefreshCoordinator,
    createRunCoordinator,
    createStartupOrchestrator,
    createRuntimeEventPublisher,
} from './services/index.js';
import type {
    ConsoleEventPublisher,
    RefreshCoordinator,
    RunCoordinator,
    RuntimeEventPublisher,
} from './services/index.js';
import type { AppDb } from './db/app/index.js';
import { createOpenAiChatAdapter, createOpenAiEmbeddingAdapter } from '@/server/v1/provider/index.js';
import type {
    ChatAdapter,
    ChatCompletionOptions,
    ChatMessage,
    ChatStructuredResult,
    EmbeddingAdapter,
} from '@/server/v1/provider/index.js';

/**
 * This wraps the database lifecycle plus the process-local runtime
 * services that do not belong in SQLite itself.
 */
export interface V2AppContext extends AppDb {
    consoleEvents: ConsoleEventPublisher;
    refreshCoordinator: RefreshCoordinator;
    runCoordinator: RunCoordinator;
    runtimeEvents: RuntimeEventPublisher;
}

// noinspection JSUnusedGlobalSymbols
export interface CreateV2AppDependencies {
    appDbPath?: string;
    consoleEventsFactory?: (appDb: AppDb) => Promise<ConsoleEventPublisher>;
    refreshCoordinatorFactory?: (
        appDb: AppDb,
        dependencies: { consoleEvents: ConsoleEventPublisher; runtimeEvents: RuntimeEventPublisher },
    ) => RefreshCoordinator;
    repoRoot?: string;
    runtimeEventsFactory?: () => RuntimeEventPublisher;
}

// noinspection JSUnusedGlobalSymbols
export const createV2App = async (dependencies: CreateV2AppDependencies = {}): Promise<V2AppContext> => {
    const repoRoot = dependencies.repoRoot ?? process.cwd();
    const appDb = await createAppDb(dependencies.appDbPath ?? resolveAppDatabasePath(dependencies.repoRoot));
    const consoleEvents = await (dependencies.consoleEventsFactory ?? createConsoleEventPublisher)(appDb);
    const runtimeEvents = (dependencies.runtimeEventsFactory ?? createRuntimeEventPublisher)();
    const refreshCoordinator = (dependencies.refreshCoordinatorFactory ?? createRefreshCoordinator)(appDb, {
        consoleEvents,
        runtimeEvents,
    });
    const runtimePaths = await resolveRuntimePaths(appDb, repoRoot);
    const embeddingProviderSettings = await readEmbeddingProviderSettings(appDb);
    const chatProviderSettings = await readChatProviderSettings(appDb);
    const retrieval = createCorpusRetrievalService({
        embeddingAdapter: createLazyEmbeddingAdapter(embeddingProviderSettings),
        reporter: {
            info: (message) => {
                console.info(message);
            },
            warn: (message) => {
                console.warn(message);
            },
        },
    });
    const partyContext = createPartyContextService(appDb);
    const startupOrchestrator = createStartupOrchestrator(appDb, {
        consoleEvents,
        refreshCoordinator,
        repoRoot,
        runtimeEvents,
    });

    await startupOrchestrator.bootstrap();
    startupOrchestrator.startBackgroundRefresh();

    return {
        db: appDb.db,
        close: appDb.close,
        refreshCoordinator,
        runCoordinator: createRunCoordinator({
            appDb,
            chat: createLazyChatAdapter({
                apiKey: chatProviderSettings.apiKey,
                baseUrl: chatProviderSettings.baseUrl,
                chatModel: chatProviderSettings.chatModel,
                debug: false,
                embeddingModel: embeddingProviderSettings.embeddingModel,
            }),
            partyContext,
            retrieval,
            retrievalDir: runtimePaths.retrievalDir,
        }),
        consoleEvents,
        runtimeEvents,
    };
};

const createLazyChatAdapter = (config: {
    apiKey: string | null;
    baseUrl: string;
    chatModel: string;
    debug: boolean;
    embeddingModel: string;
}): ChatAdapter => {
    let adapter: ChatAdapter | null = null;
    const resolveAdapter = (): ChatAdapter => {
        adapter ??= createOpenAiChatAdapter(config);
        return adapter;
    };

    return {
        complete: (messages: ChatMessage[], options?: ChatCompletionOptions) => resolveAdapter().complete(messages, options),
        completeStructured: (messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatStructuredResult> => {
            const adapter = resolveAdapter();
            if (!adapter.completeStructured) {
                throw new Error('Structured chat completion is unavailable.');
            }
            return adapter.completeStructured(messages, options);
        },
    };
};

const createLazyEmbeddingAdapter = (config: {
    apiKey: string | null;
    baseUrl: string;
    chatModel?: string;
    debug?: boolean;
    embeddingModel: string;
}): EmbeddingAdapter => {
    let adapter: EmbeddingAdapter | null = null;
    const resolveAdapter = (): EmbeddingAdapter => {
        adapter ??= createOpenAiEmbeddingAdapter({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            chatModel: config.chatModel ?? 'unused-chat-model',
            debug: config.debug ?? false,
            embeddingModel: config.embeddingModel,
        });
        return adapter;
    };

    return {
        get failedRetries() {
            return resolveAdapter().failedRetries;
        },
        get modelId() {
            return resolveAdapter().modelId;
        },
        get schemaVersion() {
            return resolveAdapter().schemaVersion;
        },
        embed: (input: string) => resolveAdapter().embed(input),
        embedBatch: (inputs: string[]) => resolveAdapter().embedBatch(inputs),
    };
};
