import { EventEmitter } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiHandler } from '@server/api/index.js';
import { createTaggedError } from '@/errors.js';
import { AppContext } from '@server/app.js';
import { RunDto, LEGACY_NPC_SESSION_ID } from '@/dto/index.js';
import { createInMemoryAppDb } from './support/app-db.js';

// ── Inline mock helpers ───────────────────────────────────────────────────────

/**
 * Builds a minimal IncomingMessage-shaped object backed by EventEmitter so
 * routes can attach `on('close', ...)` handlers, plus an async-iterable body
 * for routes that read the request payload.
 *
 * Uses an explicit AsyncIterator rather than an async generator to avoid the
 * require-await lint rule, which flags async functions that have no await.
 */
const makeRequest = (method: string, url: string, body?: string): IncomingMessage => {
    const emitter = new EventEmitter();
    const chunks = body != null ? [Buffer.from(body)] : [];
    let chunkIndex = 0;
    const asyncIterator: AsyncIterator<Buffer, void> = {
        next: (): Promise<IteratorResult<Buffer, void>> => {
            if (chunkIndex < chunks.length) {
                return Promise.resolve({ value: chunks[chunkIndex++]!, done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
        },
    };
    return Object.assign(emitter, {
        method,
        url,
        [Symbol.asyncIterator]: (): AsyncIterator<Buffer, void> => asyncIterator,
    }) as unknown as IncomingMessage;
};

/**
 * Builds a minimal ServerResponse-shaped object that tracks status, headers,
 * and written body chunks. `json()` and `body()` provide easy assertion access.
 */
const makeResponse = () => {
    const writtenChunks: string[] = [];
    const headers: Record<string, string> = {};

    const res = {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        setHeader: vi.fn((name: string, value: string) => {
            headers[name.toLowerCase()] = value;
        }),
        write: vi.fn((chunk: string) => {
            writtenChunks.push(chunk);
        }),
        end: vi.fn((chunk?: string) => {
            if (chunk) writtenChunks.push(chunk);
            res.writableEnded = true;
        }),
        flushHeaders: vi.fn(),
        on: vi.fn(),
        header: (name: string) => headers[name.toLowerCase()],
        body: () => writtenChunks.join(''),
        json: <T = unknown>() => JSON.parse(writtenChunks.join('')) as T,
    };

    return res;
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>;
let mockApp: AppContext;
let handler: ReturnType<typeof createApiHandler>;
let mockStartRun: ReturnType<typeof vi.fn>;
let mockStartRefresh: ReturnType<typeof vi.fn>;
let mockConsoleSubscribe: ReturnType<typeof vi.fn>;
let mockRuntimeSubscribe: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    appDb = await createInMemoryAppDb();
    mockStartRun = vi.fn();
    mockStartRefresh = vi.fn();
    mockConsoleSubscribe = vi.fn(() => vi.fn());
    mockRuntimeSubscribe = vi.fn(() => vi.fn());
    mockApp = {
        db: appDb.db,
        close: appDb.close,
        consoleEvents: { subscribe: mockConsoleSubscribe },
        runtimeEvents: { subscribe: mockRuntimeSubscribe },
        runCoordinator: { startRun: mockStartRun },
        refreshCoordinator: { startRefresh: mockStartRefresh },
    } as unknown as AppContext;
    handler = createApiHandler(mockApp);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await appDb.destroy();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('API router', () => {
    it('lists sessions and coerces includePartyContext to boolean', async () => {
        await appDb.db.insertInto('sessions').values({
            id: 'sess-1', mode: 'assistant', title: 'Session One',
            activeRunId: null, includePartyContext: 1, archivedAt: null,
            createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
        }).execute();

        const req = makeRequest('GET', '/api/v2/sessions');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        const sessions = res.json<Array<{ includePartyContext: boolean }>>();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.includePartyContext).toBe(true);
    });

    it('filters sessions by mode', async () => {
        await appDb.db.insertInto('sessions').values([
            { id: 's-1', mode: 'assistant', title: 'A', activeRunId: null, includePartyContext: 1, archivedAt: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
            { id: 's-2', mode: 'npc', title: 'B', activeRunId: null, includePartyContext: 1, archivedAt: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
        ]).execute();

        const req = makeRequest('GET', '/api/v2/sessions?mode=assistant');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        const sessions = res.json<Array<{ id: string }>>();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]!.id).toBe('s-1');
    });

    it('returns a session feed grouped by run with ordered session entries', async () => {
        await appDb.db.insertInto('sessions').values({
            id: 'sess-1', mode: 'assistant', title: 'Feed Test',
            activeRunId: null, includePartyContext: 1, archivedAt: null,
            createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
        }).execute();
        await appDb.db.insertInto('runs').values({
            id: 'run-1', sessionId: 'sess-1', mode: 'assistant', status: 'completed',
            prompt: 'test', retrievalTurnLimit: 1, includePartyContext: 1,
            error: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
            startedAt: null, completedAt: null, failedAt: null,
        }).execute();
        await appDb.db.insertInto('sessionEntries').values([
            { id: 'e-1', sessionId: 'sess-1', runId: 'run-1', sequenceIndex: 0, kind: 'user', content: 'First', title: null, toolCallId: null, createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 'e-2', sessionId: 'sess-1', runId: 'run-1', sequenceIndex: 1, kind: 'response', content: 'Second', title: null, toolCallId: null, createdAt: '2024-01-01T00:00:00.000Z' },
        ]).execute();

        const req = makeRequest('GET', '/api/v2/sessions/sess-1/feed');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        const feed = res.json<{ sessionId: string; items: Array<{ sessionEntries: Array<{ kind: string }> }> }>();
        expect(feed.sessionId).toBe('sess-1');
        expect(feed.items).toHaveLength(1);
        expect(feed.items[0]!.sessionEntries.map(e => e.kind)).toEqual(['user', 'response']);
    });

    it('returns not found for feed requests without a session id', async () => {
        // /api/v2/sessions/feed has four path segments; the route pattern
        // /api/v2/sessions/:sessionId/feed requires five — no match → 404.
        const req = makeRequest('GET', '/api/v2/sessions/feed');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.statusCode).toBe(404);
    });

    it('starts a run from POST /api/v2/runs', async () => {
        const runDto: RunDto = {
            id: 'run-1', sessionId: 'sess-1', mode: 'assistant',
            status: 'completed', updatedAt: '2024-01-01T00:00:00.000Z', sessionEntries: [],
        };
        mockStartRun.mockResolvedValue(runDto);

        const body = JSON.stringify({ sessionId: 'sess-1', prompt: 'hello', mode: 'assistant', retrievalTurnLimit: 1 });
        const req = makeRequest('POST', '/api/v2/runs', body);
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(mockStartRun).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'sess-1', prompt: 'hello' }),
        );
        expect(res.json<{ id: string }>().id).toBe('run-1');
    });

    it('rejects POST /api/v2/runs for the legacy NPC session', async () => {
        const body = JSON.stringify({ sessionId: LEGACY_NPC_SESSION_ID, prompt: 'hello', mode: 'npc', retrievalTurnLimit: 1 });
        const req = makeRequest('POST', '/api/v2/runs', body);
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.statusCode).toBe(400);
        expect(mockStartRun).not.toHaveBeenCalled();
    });

    it('reads refresh state from GET /api/v2/refresh', async () => {
        await appDb.db.insertInto('refreshState').values({
            singletonKey: 1,
            activeOperation: null,
            refreshStatus: 'completed',
            reingestStatus: 'pending',
            lastRefreshAt: null,
            lastReingestAt: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        }).execute();

        const req = makeRequest('GET', '/api/v2/refresh');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.json<{ refreshStatus: string }>().refreshStatus).toBe('completed');
    });

    it('starts refresh from POST /api/v2/refresh', async () => {
        mockStartRefresh.mockResolvedValue({ refreshStatus: 'running' });

        const req = makeRequest('POST', '/api/v2/refresh', JSON.stringify({ kind: 'refresh' }));
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(mockStartRefresh).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'refresh' }),
        );
        expect(res.json<{ refreshStatus: string }>().refreshStatus).toBe('running');
    });

    it('lists NPCs with default pagination', async () => {
        await appDb.db.insertInto('sessions').values({
            id: 'sess-1', mode: 'npc', title: 'NPC Session', activeRunId: null,
            includePartyContext: 1, archivedAt: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
        }).execute();
        await appDb.db.insertInto('runs').values({
            id: 'run-1', sessionId: 'sess-1', mode: 'npc', status: 'completed',
            prompt: 'Generate NPC', retrievalTurnLimit: 1, includePartyContext: 1,
            error: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
            startedAt: null, completedAt: null, failedAt: null,
        }).execute();
        await appDb.db.insertInto('npcs').values({
            id: 1, sessionId: 'sess-1', runId: 'run-1',
            name: 'Zara', bio: 'A rogue.', description: 'Lithe and quick.',
            age: null, ethnicity: null, gender: null, role: null, species: null,
            createdAt: null, updatedAt: null,
        }).execute();

        const req = makeRequest('GET', '/api/v2/npcs');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        const collection = res.json<{ npcs: Array<{ name: string }>; skip: number; take: number }>();
        expect(collection.npcs).toHaveLength(1);
        expect(collection.npcs[0]!.name).toBe('Zara');
        expect(collection.skip).toBe(0);
        expect(collection.take).toBe(20);
    });

    it('lists NPCs with skip take and filter query params', async () => {
        await appDb.db.insertInto('sessions').values({
            id: 'sess-1', mode: 'npc', title: 'NPC Session', activeRunId: null,
            includePartyContext: 1, archivedAt: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
        }).execute();
        await appDb.db.insertInto('runs').values({
            id: 'run-1', sessionId: 'sess-1', mode: 'npc', status: 'completed',
            prompt: 'Generate NPC', retrievalTurnLimit: 1, includePartyContext: 1,
            error: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
            startedAt: null, completedAt: null, failedAt: null,
        }).execute();
        await appDb.db.insertInto('npcs').values([
            { id: 1, sessionId: 'sess-1', runId: 'run-1', name: 'Zara', bio: 'A rogue.', description: 'Lithe.', age: null, ethnicity: null, gender: null, role: null, species: null, createdAt: null, updatedAt: null },
            { id: 2, sessionId: 'sess-1', runId: 'run-1', name: 'Drowning Dale', bio: 'A bard.', description: 'Loud.', age: null, ethnicity: null, gender: null, role: null, species: null, createdAt: null, updatedAt: null },
        ]).execute();

        const req = makeRequest('GET', '/api/v2/npcs?skip=0&take=5&filter=drown');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        const collection = res.json<{ npcs: Array<{ name: string }>; take: number }>();
        expect(collection.npcs).toHaveLength(1);
        expect(collection.npcs[0]!.name).toBe('Drowning Dale');
        expect(collection.take).toBe(5);
    });

    it('reads additional context as markdown', async () => {
        const req = makeRequest('GET', '/api/v2/additional-context');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.header('content-type')).toContain('text/markdown');
    });

    it('writes additional context as markdown', async () => {
        const req = makeRequest('PUT', '/api/v2/additional-context', '# My notes');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.body()).toBe('# My notes');
        expect(res.header('content-type')).toContain('text/markdown');
    });

    it('streams console SSE entries', () => {
        let capturedCallback: ((entry: unknown) => void) | undefined;
        mockConsoleSubscribe.mockImplementation((cb: (entry: unknown) => void) => {
            capturedCallback = cb;
            return vi.fn();
        });

        const req = makeRequest('GET', '/api/v2/events/console');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        expect(res.header('content-type')).toContain('text/event-stream');
        expect(capturedCallback).toBeDefined();

        capturedCallback!({ id: 'e-1', level: 'info', message: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' });

        const writes = (res.write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
        expect(writes.some(w => w.startsWith('data:'))).toBe(true);
    });

    it('streams runtime SSE events', () => {
        let capturedCallback: ((event: unknown) => void) | undefined;
        mockRuntimeSubscribe.mockImplementation((cb: (event: unknown) => void) => {
            capturedCallback = cb;
            return vi.fn();
        });

        const req = makeRequest('GET', '/api/v2/events/runtime');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        expect(res.header('content-type')).toContain('text/event-stream');
        expect(capturedCallback).toBeDefined();

        capturedCallback!({ resource: 'run', sessionId: 'sess-1' });

        const writes = (res.write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
        expect(writes.some(w => w.startsWith('data:'))).toBe(true);
    });

    it('maps tagged application errors to structured API error responses', async () => {
        mockStartRun.mockRejectedValue(
            createTaggedError('run-session-missing', 'Session not found'),
        );

        const req = makeRequest('POST', '/api/v2/runs', JSON.stringify({ prompt: 'hi', mode: 'assistant', retrievalTurnLimit: 1 }));
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.statusCode).toBe(404);
        expect(res.json<{ error: string }>().error).toBe('Session not found');
    });

    it('returns 404 for unknown routes', async () => {
        const req = makeRequest('GET', '/api/v2/nonexistent');
        const res = makeResponse();

        handler(req, res as unknown as ServerResponse);

        await vi.waitFor(() => expect(res.writableEnded).toBe(true));

        expect(res.statusCode).toBe(404);
    });
});
