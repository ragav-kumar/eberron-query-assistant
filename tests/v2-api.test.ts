import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createV2ApiHandler } from '@/server/v2/api/index.js';
import type { V2AppContext } from '@/server/v2/app.js';
import { createAppDb } from '@/server/v2/db/index.js';
import { settingKeys } from '@/server/v2/db/settingKeys.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-api');

class MockRequest extends EventEmitter {
    method?: string;
    url?: string;
}

interface ResponseRecord {
    body: string;
    ended: boolean;
    flushHeadersCalls: number;
    headers: Record<string, string>;
    statusCode: number;
    writes: string[];
}

const createResponse = (): { record: ResponseRecord; response: ServerResponse } => {
    const record: ResponseRecord = {
        body: '',
        ended: false,
        flushHeadersCalls: 0,
        headers: {},
        statusCode: 0,
        writes: [],
    };

    const response = {
        end: (body?: string) => {
            record.ended = true;
            if (body != null) {
                record.body = body;
            }
        },
        flushHeaders: () => {
            record.flushHeadersCalls += 1;
        },
        setHeader: (name: string, value: string) => {
            record.headers[name] = value;
        },
        statusCode: 0,
        write: (chunk: string) => {
            record.writes.push(chunk);
            return true;
        },
    } as Partial<ServerResponse>;

    Object.defineProperty(response, 'statusCode', {
        get: () => record.statusCode,
        set: (value: number) => {
            record.statusCode = value;
        },
    });

    return { record, response: response as ServerResponse };
};

const createRequest = (method: string, url: string): IncomingMessage => {
    const request = new MockRequest();
    request.method = method;
    request.url = url;
    return request as IncomingMessage;
};

const flushAsyncHandlers = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

describe('V2 API router', () => {
    let app: V2AppContext;
    let handleV2ApiRequest: ReturnType<typeof createV2ApiHandler>;

    beforeEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });

        const config = loadDefaultConfig(TEST_ROOT);
        const appDb = await createAppDb(config);
        app = {
            close: appDb.close,
            db: appDb.db,
        };

        await app.db.insertInto('settings').values({
            key: settingKeys.additionalContext,
            modifiedAt: '2026-05-17T00:00:00.000Z',
            value: '# Campaign Context',
        }).execute();
        await app.db.insertInto('sessions').values({
            activeRunId: null,
            archivedAt: null,
            createdAt: '2026-05-07T21:10:42.000Z',
            id: 'session-dal-quor',
            includePartyContext: 1,
            mode: 'assistant',
            title: 'Dal Quor vault pitch',
            updatedAt: '2026-05-07T21:10:48.000Z',
        }).execute();
        await app.db.insertInto('runs').values({
            completedAt: '2026-05-07T21:10:48.000Z',
            createdAt: '2026-05-07T21:10:42.000Z',
            error: null,
            exchangeId: 'exchange-dal-quor-1',
            failedAt: null,
            id: 'run-dal-quor-1',
            includePartyContext: 1,
            mode: 'assistant',
            prompt: 'Prompt',
            retrievalTurnLimit: 1,
            sessionId: 'session-dal-quor',
            startedAt: '2026-05-07T21:10:42.000Z',
            status: 'completed',
            updatedAt: '2026-05-07T21:10:48.000Z',
        }).execute();
        await app.db
            .updateTable('sessions')
            .set({ activeRunId: 'run-dal-quor-1' })
            .where('id', '=', 'session-dal-quor')
            .execute();
        await app.db.insertInto('sessionExchanges').values([
            {
                content: 'Prompt',
                createdAt: '2026-05-07T21:10:42.000Z',
                exchangeId: 'exchange-dal-quor-1',
                id: 'exchange-dal-quor-user-1',
                kind: 'user',
                runId: 'run-dal-quor-1',
                sequenceIndex: 1,
                sessionId: 'session-dal-quor',
                title: null,
                toolCallId: null,
            },
            {
                content: 'Answer',
                createdAt: '2026-05-07T21:10:48.000Z',
                exchangeId: 'exchange-dal-quor-1',
                id: 'exchange-dal-quor-response-1',
                kind: 'response',
                runId: 'run-dal-quor-1',
                sequenceIndex: 2,
                sessionId: 'session-dal-quor',
                title: 'Answer',
                toolCallId: null,
            },
        ]).execute();

        handleV2ApiRequest = createV2ApiHandler(app);
    });

    afterEach(async () => {
        await app.close();
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    it('returns additional context markdown unchanged', async () => {
        const request = createRequest('GET', '/api/v2/additional-context');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(200);
        expect(record.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
        expect(record.body).toContain('# Campaign Context');
    });

    it('preserves session mode filtering', async () => {
        const request = createRequest('GET', '/api/v2/sessions?mode=assistant');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        await flushAsyncHandlers();

        const sessions = JSON.parse(record.body) as Array<{ mode: string }>;

        expect(record.statusCode).toBe(200);
        expect(sessions).toHaveLength(1);
        expect(sessions.every(session => session.mode === 'assistant')).toBe(true);
    });

    it('resolves session feed and run routes with path params', async () => {
        const feedRequest = createRequest('GET', '/api/v2/sessions/session-dal-quor/feed');
        const feedResult = createResponse();

        handleV2ApiRequest(feedRequest, feedResult.response);
        await flushAsyncHandlers();

        expect(feedResult.record.statusCode).toBe(200);
        expect(JSON.parse(feedResult.record.body)).toMatchObject({
            mode: 'assistant',
            sessionId: 'session-dal-quor',
        });

        const runRequest = createRequest('GET', '/api/v2/runs/run-dal-quor-1');
        const runResult = createResponse();

        handleV2ApiRequest(runRequest, runResult.response);
        await flushAsyncHandlers();

        expect(runResult.record.statusCode).toBe(200);
        expect(JSON.parse(runResult.record.body)).toMatchObject({
            id: 'run-dal-quor-1',
        });
    });

    it('returns the same 404 body for unknown routes', async () => {
        const request = createRequest('GET', '/api/v2/not-a-route');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(404);
        expect(record.headers['Content-Type']).toBe('application/json; charset=utf-8');
        expect(JSON.parse(record.body)).toEqual({ error: 'Unknown API route.' });
    });

    it('does not match incomplete session feed paths', async () => {
        const request = createRequest('GET', '/api/v2/sessions/session-dal-quor');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(404);
        expect(JSON.parse(record.body)).toEqual({ error: 'Unknown API route.' });
    });

    it('preserves SSE headers and connection prelude', () => {
        const request = createRequest('GET', '/api/v2/events/console');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);

        expect(record.statusCode).toBe(200);
        expect(record.headers).toMatchObject({
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Content-Type': 'text/event-stream; charset=utf-8',
        });
        expect(record.flushHeadersCalls).toBe(1);
        expect(record.writes).toEqual([': connected\n\n']);

        (request as unknown as MockRequest).emit('close');

        expect(record.ended).toBe(true);
    });
});
