import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateV2AppDependencies, V2AppContext } from '@/server/v2/app.js';

const createV2App = vi.fn<(dependencies?: CreateV2AppDependencies) => Promise<V2AppContext>>();
const createV2ApiHandler = vi.fn<(app: V2AppContext) => (request: IncomingMessage, response: ServerResponse) => void>();

vi.mock('@/server/v2/app.js', () => ({
    createV2App,
}));

vi.mock('@/server/v2/api/index.js', () => ({
    createV2ApiHandler,
}));

describe('V2 server runtime', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('assembles a reusable request handler from the app context and api handler', async () => {
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

        const { createV2ServerRuntime } = await import('@/server/v2/server.js');
        const runtime = await createV2ServerRuntime({ repoRoot: 'C:/repo-root' });

        expect(createV2App).toHaveBeenCalledWith({ repoRoot: 'C:/repo-root' });
        expect(createV2ApiHandler).toHaveBeenCalledWith(app);
        expect(runtime.handleRequest).toBe(handleRequest);
        expect(runtime.close).toBe(close);
    });

    it('uses the same request handler across multiple calls after assembly', async () => {
        const app = {
            close: vi.fn().mockResolvedValue(undefined),
            consoleEvents: {} as V2AppContext['consoleEvents'],
            db: {} as V2AppContext['db'],
            refreshCoordinator: {} as V2AppContext['refreshCoordinator'],
            runCoordinator: {} as V2AppContext['runCoordinator'],
            runtimeEvents: {} as V2AppContext['runtimeEvents'],
        } satisfies V2AppContext;
        const handleRequest = vi.fn();
        createV2App.mockResolvedValue(app);
        createV2ApiHandler.mockReturnValue(handleRequest);

        const { createV2ServerRuntime } = await import('@/server/v2/server.js');
        const runtime = await createV2ServerRuntime();
        const request = {} as IncomingMessage;
        const response = {} as ServerResponse;

        runtime.handleRequest(request, response);
        runtime.handleRequest(request, response);

        expect(handleRequest).toHaveBeenCalledTimes(2);
        expect(handleRequest).toHaveBeenNthCalledWith(1, request, response);
        expect(handleRequest).toHaveBeenNthCalledWith(2, request, response);
    });
});
