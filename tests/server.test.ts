import { afterEach, describe, expect, it, vi } from 'vitest';

describe('V2 server runtime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('returns the API request handler assembled from the app runtime', async () => {
        const close = vi.fn().mockResolvedValue(undefined);
        const app = {
            close,
            consoleEvents: {},
            db: {},
            refreshCoordinator: {},
            runCoordinator: {},
            runtimeEvents: {},
        };
        const createApp = vi.fn().mockResolvedValue(app);
        const handleRequest = vi.fn();
        const createApiHandler = vi.fn().mockReturnValue(handleRequest);

        vi.doMock('@server/app.js', () => ({ createApp }));
        vi.doMock('@server/api/index.js', () => ({ createApiHandler }));

        const { createServerRuntime } = await import('@server/server.js');
        const runtime = await createServerRuntime({ repoRoot: 'C:/repo-root' });

        expect(createApp).toHaveBeenCalledWith({ repoRoot: 'C:/repo-root' });
        expect(createApiHandler).toHaveBeenCalledWith(app);
        expect(runtime.handleRequest).toBe(handleRequest);
        expect(runtime.close).toBe(close);
    });

    it('closes the runtime when the HTTP host shuts down', async () => {
        const runtime = {
            close: vi.fn().mockResolvedValue(undefined),
            handleRequest: vi.fn(),
        };

        const { startServer } = await import('@server/server.js');
        const startedServer = await startServer({
            host: '127.0.0.1',
            port: 0,
            runtime,
        });

        await startedServer.close();

        expect(runtime.close).toHaveBeenCalledTimes(1);
    });

    it('bootstraps settings and startup refresh orchestration when creating the app', async () => {
        vi.doUnmock('@server/app.js');
        const appDb = {
            close: vi.fn().mockResolvedValue(undefined),
            db: {},
        };
        const initializeSettingsStore = vi.fn().mockResolvedValue(undefined);
        const createAppDb = vi.fn().mockResolvedValue(appDb);
        const createConsoleEventPublisher = vi.fn().mockReturnValue({ kind: 'console' });
        const createRuntimeEventPublisher = vi.fn().mockReturnValue({ kind: 'runtime' });
        const createRefreshVisibility = vi.fn().mockReturnValue({ kind: 'visibility' });
        const createRefreshCoordinator = vi.fn().mockReturnValue({ kind: 'refresh' });
        const createStartupOrchestrator = vi.fn().mockReturnValue({
            initialize: vi.fn().mockResolvedValue(undefined),
        });
        const createRunCoordinator = vi.fn().mockReturnValue({ kind: 'run' });
        const createCorpusRetrievalService = vi.fn().mockReturnValue({ kind: 'retrieval' });
        const createPartyContextService = vi.fn().mockReturnValue({ kind: 'partyContext' });
        const createOpenAiChatAdapter = vi.fn().mockReturnValue({ kind: 'chat' });
        const createOpenAiEmbeddingAdapter = vi.fn().mockReturnValue({ kind: 'embedding' });
        const settingsStoreMock = vi.fn(() => ({
            read: (key: string) => ({
                articleHtmlCacheDir: '.cache/articles',
                foundrySourceDir: 'foundry',
                pdfSourceDir: 'pdf',
                providerApiKey: 'key',
                providerBaseUrl: 'https://api.example.com/v1',
                providerChatModel: 'chat-model',
                providerEmbeddingModel: 'embedding-model',
                retrievalDir: '.retrieval',
                retrievalMaxVectorCacheDatabaseBytes: 123,
            } as Record<string, unknown>)[key],
        }));

        vi.doMock('@server/db/app/index.js', () => ({
            createAppDb,
            initializeSettingsStore,
            settingsStore: settingsStoreMock,
        }));
        vi.doMock('@server/db/corpus/index.js', () => ({
            createCorpusRetrievalService,
            createPartyContextService,
        }));
        vi.doMock('@server/services/index.js', () => ({
            createConsoleEventPublisher,
            createRefreshCoordinator,
            createRefreshVisibility,
            createRunCoordinator,
            createRuntimeEventPublisher,
            createStartupOrchestrator,
        }));
        vi.doMock('@server/services/provider/index.js', () => ({
            createOpenAiChatAdapter,
            createOpenAiEmbeddingAdapter,
        }));

        const { createApp } = await import('@server/app.js');
        await createApp({ repoRoot: 'C:/repo-root' });

        expect(createAppDb).toHaveBeenCalledTimes(1);
        expect(initializeSettingsStore).toHaveBeenCalledWith(appDb);
        expect(createRefreshVisibility).toHaveBeenCalledWith({ kind: 'console' }, { kind: 'runtime' });
        expect(createRefreshCoordinator).toHaveBeenCalledWith(appDb, { visibility: { kind: 'visibility' } });
        expect(createStartupOrchestrator).toHaveBeenCalledWith(appDb, {
            consoleEvents: { kind: 'console' },
            refreshCoordinator: { kind: 'refresh' },
            runtimeEvents: { kind: 'runtime' },
        });
        const runCoordinatorArgs = createRunCoordinator.mock.calls[0]?.[0] as {
            appDb: unknown;
            chat: unknown;
            partyContext: unknown;
            retrieval: unknown;
            retrievalDir: string;
        };
        expect(runCoordinatorArgs.appDb).toBe(appDb);
        expect(runCoordinatorArgs.chat).toEqual({ kind: 'chat' });
        expect(runCoordinatorArgs.partyContext).toEqual({ kind: 'partyContext' });
        expect(runCoordinatorArgs.retrieval).toEqual({ kind: 'retrieval' });
        expect(runCoordinatorArgs.retrievalDir).toBe('C:\\repo-root\\.retrieval');
    });

    it('fails startup when persisted runtime paths are absolute', async () => {
        vi.doUnmock('@server/app.js');
        const createAppDb = vi.fn().mockResolvedValue({
            close: vi.fn().mockResolvedValue(undefined),
            db: {},
        });
        const initializeSettingsStore = vi.fn().mockResolvedValue(undefined);
        const settingsStoreMock = vi.fn(() => ({
            read: (key: string) => ({
                articleHtmlCacheDir: '.cache/articles',
                foundrySourceDir: 'foundry',
                pdfSourceDir: 'pdf',
                providerApiKey: 'key',
                providerBaseUrl: 'https://api.example.com/v1',
                providerChatModel: 'chat-model',
                providerEmbeddingModel: 'embedding-model',
                retrievalDir: 'C:\\absolute\\retrieval',
                retrievalMaxVectorCacheDatabaseBytes: 123,
            } as Record<string, unknown>)[key],
        }));

        vi.doMock('@server/db/app/index.js', () => ({
            createAppDb,
            initializeSettingsStore,
            settingsStore: settingsStoreMock,
        }));
        vi.doMock('@server/db/corpus/index.js', () => ({
            createCorpusRetrievalService: vi.fn(),
            createPartyContextService: vi.fn(),
        }));
        vi.doMock('@server/services/index.js', () => ({
            createConsoleEventPublisher: vi.fn().mockReturnValue({}),
            createRefreshCoordinator: vi.fn().mockReturnValue({}),
            createRefreshVisibility: vi.fn().mockReturnValue({}),
            createRunCoordinator: vi.fn().mockReturnValue({}),
            createRuntimeEventPublisher: vi.fn().mockReturnValue({}),
            createStartupOrchestrator: vi.fn().mockReturnValue({
                initialize: vi.fn().mockResolvedValue(undefined),
            }),
        }));
        vi.doMock('@server/services/provider/index.js', () => ({
            createOpenAiChatAdapter: vi.fn(),
            createOpenAiEmbeddingAdapter: vi.fn(),
        }));

        const { createApp } = await import('@server/app.js');

        await expect(createApp({ repoRoot: 'C:/repo-root' })).rejects.toThrow('must be relative to the repo root');
    });
});
