import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateV2AppDependencies, V2AppContext } from '@server/app.js';

const createV2App = vi.fn<(dependencies?: CreateV2AppDependencies) => Promise<V2AppContext>>();
const createV2ApiHandler = vi.fn<(app: V2AppContext) => (request: IncomingMessage, response: ServerResponse) => void>();

vi.mock('@server/app.js', () => ({
    createV2App,
}));

vi.mock('@server/api/index.js', () => ({
    createV2ApiHandler,
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
            consoleEvents: {} as V2AppContext['consoleEvents'],
            db: {} as V2AppContext['db'],
            refreshCoordinator: {} as V2AppContext['refreshCoordinator'],
            runCoordinator: {} as V2AppContext['runCoordinator'],
            runtimeEvents: {} as V2AppContext['runtimeEvents'],
        } satisfies V2AppContext;
        const handleRequest = vi.fn();
        createV2App.mockResolvedValue(app);
        createV2ApiHandler.mockReturnValue(handleRequest);

        const { createV2ServerRuntime } = await import('@server/server.js');
        const runtime = await createV2ServerRuntime({ repoRoot: 'C:/repo-root' });

        expect(createV2App).toHaveBeenCalledWith({ repoRoot: 'C:/repo-root' });
        expect(createV2ApiHandler).toHaveBeenCalledWith(app);
        expect(runtime.handleRequest).toBe(handleRequest);
        expect(runtime.close).toBe(close);
    });

    it('closes the runtime when the HTTP host shuts down', async () => {
        const runtime = {
            close: vi.fn().mockResolvedValue(undefined),
            handleRequest: vi.fn(),
        };

        const { startV2Server } = await import('@server/server.js');
        const startedServer = await startV2Server({
            host: '127.0.0.1',
            port: 0,
            runtime,
        });

        await startedServer.close();

        expect(runtime.close).toHaveBeenCalledTimes(1);
    });
});
