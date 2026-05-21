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

        const { createV2ServerRuntime } = await import('@server/server.js');
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

        const { createV2ServerRuntime } = await import('@server/server.js');
        const runtime = await createV2ServerRuntime();
        const request = {} as IncomingMessage;
        const response = {} as ServerResponse;

        runtime.handleRequest(request, response);
        runtime.handleRequest(request, response);

        expect(handleRequest).toHaveBeenCalledTimes(2);
        expect(handleRequest).toHaveBeenNthCalledWith(1, request, response);
        expect(handleRequest).toHaveBeenNthCalledWith(2, request, response);
    });

    it('starts an http host that delegates only /api/v2 routes', async () => {
        const handleRequest = vi.fn((request: IncomingMessage, response: ServerResponse) => {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ path: request.url }));
        });
        const runtime = {
            close: vi.fn().mockResolvedValue(undefined),
            handleRequest,
        };

        const { startV2Server } = await import('@server/server.js');
        const startedServer = await startV2Server({
            host: '127.0.0.1',
            port: 0,
            runtime,
        });

        try {
            const okResponse = await fetch(`http://127.0.0.1:${startedServer.port}/api/v2/events/console`);
            expect(okResponse.status).toBe(200);
            await expect(okResponse.json()).resolves.toEqual({ path: '/api/v2/events/console' });
            expect(handleRequest).toHaveBeenCalledTimes(1);

            const missingResponse = await fetch(`http://127.0.0.1:${startedServer.port}/not-v2`);
            expect(missingResponse.status).toBe(404);
            await expect(missingResponse.json()).resolves.toEqual({ error: 'Unknown API route.' });
            expect(handleRequest).toHaveBeenCalledTimes(1);
        } finally {
            await startedServer.close();
        }
    });

    it('preserves sse connectivity through the node host', async () => {
        const runtime = {
            close: vi.fn().mockResolvedValue(undefined),
            handleRequest: vi.fn((_request: IncomingMessage, response: ServerResponse) => {
                response.statusCode = 200;
                response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                response.setHeader('Cache-Control', 'no-cache, no-transform');
                response.setHeader('Connection', 'keep-alive');
                response.flushHeaders?.();
                response.write(': connected\n\n');
                response.write('data: {"kind":"console"}\n\n');
            }),
        };

        const { startV2Server } = await import('@server/server.js');
        const startedServer = await startV2Server({
            host: '127.0.0.1',
            port: 0,
            runtime,
        });

        try {
            const response = await fetch(`http://127.0.0.1:${startedServer.port}/api/v2/events/console`);
            expect(response.status).toBe(200);
            const reader = response.body?.getReader();
            expect(reader).toBeDefined();
            const firstChunk = await reader?.read();
            const decoder = new TextDecoder();
            const chunkText = decoder.decode(firstChunk?.value);

            expect(chunkText).toContain(': connected');
            expect(chunkText).toContain('data: {"kind":"console"}');

            await reader?.cancel();
        } finally {
            await startedServer.close();
        }
    });

    it('closes the runtime when the node host shuts down', async () => {
        const close = vi.fn().mockResolvedValue(undefined);
        const runtime = {
            close,
            handleRequest: vi.fn(),
        };

        const { startV2Server } = await import('@server/server.js');
        const startedServer = await startV2Server({
            host: '127.0.0.1',
            port: 0,
            runtime,
        });

        await startedServer.close();

        expect(close).toHaveBeenCalledTimes(1);
    });
});
