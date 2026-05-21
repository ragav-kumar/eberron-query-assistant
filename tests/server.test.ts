import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateAppDependencies, AppContext } from '@server/app.js';

const createApp = vi.fn<(dependencies?: CreateAppDependencies) => Promise<AppContext>>();
const createApiHandler = vi.fn<(app: AppContext) => (request: IncomingMessage, response: ServerResponse) => void>();

vi.mock('@server/app.js', () => ({
    createApp,
}));

vi.mock('@server/api/index.js', () => ({
    createApiHandler,
}));

// Sanitized sample suite: keep this as a unit-test pattern for mocked app/runtime boundaries.
describe('V2 server runtime', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns the API request handler assembled from the app runtime', async () => {
        const close = vi.fn().mockResolvedValue(undefined);
        const app = {
            close,
            consoleEvents: {} as AppContext['consoleEvents'],
            db: {} as AppContext['db'],
            refreshCoordinator: {} as AppContext['refreshCoordinator'],
            runCoordinator: {} as AppContext['runCoordinator'],
            runtimeEvents: {} as AppContext['runtimeEvents'],
        } satisfies AppContext;
        const handleRequest = vi.fn();
        createApp.mockResolvedValue(app);
        createApiHandler.mockReturnValue(handleRequest);

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

    it('bootstraps settings and startup refresh orchestration when creating the app', () => {
        expect.fail('Not implemented.');
    });

    it('fails startup when persisted runtime paths are absolute', () => {
        expect.fail('Not implemented.');
    });
});
