import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConsoleEntryDto, CreateRefreshDto, CreateRunDto } from '@/dto/index.js';
import { createV2ApiHandler } from '@/server/v2/api/index.js';
import type { V2AppContext } from '@/server/v2/app.js';
import { createAppDb, getDefaultAppDatabasePath } from '@/server/v2/db/app/index.js';
import { settingKeys } from '@/server/v2/db/app/settingKeys.js';
import { createRuntimeEventPublisher } from '@/server/v2/services/index.js';

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
    let consoleListener: ((entry: ConsoleEntryDto) => void) | null;

    beforeEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
        consoleListener = null;

        const appDb = await createAppDb(getDefaultAppDatabasePath(TEST_ROOT));
        await initializeRefreshState(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        app = {
            close: appDb.close,
            consoleEvents: {
                debug: (message, timestamp = '2026-05-18T00:00:00.000Z') => Promise.resolve({
                    id: 'console-debug',
                    level: 'debug',
                    message,
                    timestamp,
                }),
                error: (message, timestamp = '2026-05-18T00:00:00.000Z') => Promise.resolve({
                    id: 'console-error',
                    level: 'error',
                    message,
                    timestamp,
                }),
                info: (message, timestamp = '2026-05-18T00:00:00.000Z') => Promise.resolve({
                    id: 'console-info',
                    level: 'info',
                    message,
                    timestamp,
                }),
                snapshot: () => Promise.resolve([{
                    id: 'console-1',
                    level: 'info',
                    message: 'Snapshot entry',
                    timestamp: '2026-05-18T00:00:00.000Z',
                }]),
                subscribe: listener => {
                    consoleListener = listener;
                    return () => {
                        consoleListener = null;
                    };
                },
                warn: (message, timestamp = '2026-05-18T00:00:00.000Z') => Promise.resolve({
                    id: 'console-warn',
                    level: 'warn',
                    message,
                    timestamp,
                }),
            },
            db: appDb.db,
            refreshCoordinator: {
                startRefresh: async (_request: CreateRefreshDto) => {
                    console.warn('POST /api/v2/refresh is not implemented');
                    const refresh = await appDb.db
                        .selectFrom('refreshState')
                        .selectAll()
                        .executeTakeFirstOrThrow();

                    return {
                        activeOperation: refresh.activeOperation,
                        createdAt: refresh.createdAt,
                        lastRefreshAt: refresh.lastRefreshAt,
                        lastReingestAt: refresh.lastReingestAt,
                        refreshStatus: refresh.refreshStatus,
                        reingestStatus: refresh.reingestStatus,
                        updatedAt: refresh.updatedAt,
                    };
                },
            },
            runCoordinator: {
                startRun: (_request: CreateRunDto) => {
                    console.warn('POST /api/v2/runs is not implemented');
                    throw new Error('POST /api/v2/runs is not implemented');
                },
            },
            runtimeEvents,
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
        await app.db.insertInto('sessionEntries').values([
            {
                content: 'Prompt',
                createdAt: '2026-05-07T21:10:42.000Z',
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

    it('resolves session feed routes with path params', async () => {
        const feedRequest = createRequest('GET', '/api/v2/sessions/session-dal-quor/feed');
        const feedResult = createResponse();

        handleV2ApiRequest(feedRequest, feedResult.response);
        await flushAsyncHandlers();

        expect(feedResult.record.statusCode).toBe(200);
        expect(JSON.parse(feedResult.record.body)).toMatchObject({
            mode: 'assistant',
            sessionId: 'session-dal-quor',
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

    it('returns the console snapshot from the publisher', async () => {
        const request = createRequest('GET', '/api/v2/console');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(200);
        expect(JSON.parse(record.body)).toEqual([
            {
                id: 'console-1',
                level: 'info',
                message: 'Snapshot entry',
                timestamp: '2026-05-18T00:00:00.000Z',
            },
        ]);
    });

    it('streams publisher console entries over SSE', () => {
        const request = createRequest('GET', '/api/v2/events/console');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        consoleListener?.({
            id: 'console-2',
            level: 'warn',
            message: 'Streaming entry',
            timestamp: '2026-05-18T00:00:02.000Z',
        });

        expect(record.writes).toEqual([
            ': connected\n\n',
            'data: {"id":"console-2","level":"warn","message":"Streaming entry","timestamp":"2026-05-18T00:00:02.000Z"}\n\n',
        ]);

        (request as unknown as MockRequest).emit('close');
        expect(consoleListener).toBeNull();
    });

    it('streams runtime events over SSE', () => {
        const request = createRequest('GET', '/api/v2/events/runtime');
        const { record, response } = createResponse();

        handleV2ApiRequest(request, response);
        app.runtimeEvents.publishRefreshEvent({
            action: 'updated',
            kind: 'refresh',
            resourceId: 'refresh',
            status: 'running',
            timestamp: '2026-05-18T00:00:03.000Z',
        });

        expect(record.writes).toEqual([
            ': connected\n\n',
            'data: {"action":"updated","kind":"refresh","resourceId":"refresh","status":"running","timestamp":"2026-05-18T00:00:03.000Z","resource":"refresh"}\n\n',
        ]);
    });
});

const initializeRefreshState = async (appDb: Awaited<ReturnType<typeof createAppDb>>): Promise<void> => {
    const now = '2026-05-17T00:00:00.000Z';

    await appDb.db
        .insertInto('refreshState')
        .values({
            singletonKey: 1,
            activeOperation: null,
            refreshStatus: 'failed',
            reingestStatus: 'failed',
            lastRefreshAt: null,
            lastReingestAt: null,
            createdAt: now,
            updatedAt: now,
        })
        .onConflict(conflict => conflict.column('singletonKey').doNothing())
        .execute();
};
