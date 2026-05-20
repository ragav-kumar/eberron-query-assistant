import { rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateRunDto } from '@/dto/index.js';
import { createV2ApiHandler } from '@/server/v2/api/index.js';
import type { V2AppContext } from '@/server/v2/app.js';
import { createAppDb, getDefaultAppDatabasePath } from '@/server/v2/db/app/index.js';
import { settingKeys } from '@/server/v2/db/app/settingKeys.js';
import { createRunCoordinator } from '@/server/v2/services/run-coordinator.js';
import type { V2PromptAssets } from '@/server/v2/services/run-runtime.js';
import type { ChatAdapter } from '@/server/v1/provider/index.js';
import type { CorpusRetrievalService, PartyContextService } from '@/server/v2/db/corpus/index.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-runs');

const PROMPT_ASSETS: V2PromptAssets = {
    assistant: 'Assistant mode instructions.',
    sessionTitling: 'Include a session title.',
    shared: 'Shared exchange protocol instructions.',
};

interface ResponseRecord {
    body: string;
    headers: Record<string, string>;
    statusCode: number;
}

const createResponse = (): { record: ResponseRecord; response: ServerResponse } => {
    const record: ResponseRecord = {
        body: '',
        headers: {},
        statusCode: 0,
    };

    const response = {
        end: (body?: string) => {
            if (body != null) {
                record.body = body;
            }
        },
        setHeader: (name: string, value: string) => {
            record.headers[name] = value;
        },
        statusCode: 0,
    } as Partial<ServerResponse>;

    Object.defineProperty(response, 'statusCode', {
        get: () => record.statusCode,
        set: (value: number) => {
            record.statusCode = value;
        },
    });

    return {record, response: response as ServerResponse};
};

const createJsonRequest = (method: string, url: string, body: unknown): IncomingMessage => {
    const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage & Readable;
    stream.method = method;
    stream.url = url;
    return stream;
};

const flushAsyncHandlers = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

describe('V2 run coordinator', () => {
    let appDb: Awaited<ReturnType<typeof createAppDb>>;
    let chat: ChatAdapter;
    let partyContext: PartyContextService;
    let retrieval: CorpusRetrievalService;

    beforeEach(async () => {
        await rm(TEST_ROOT, {force: true, recursive: true});
        appDb = await createAppDb(getDefaultAppDatabasePath(TEST_ROOT));
        await initializeRefreshState(appDb);
        await appDb.db.insertInto('settings').values({
            key: settingKeys.additionalContext,
            modifiedAt: '2026-05-19T00:00:00.000Z',
            value: '# Additional Context',
        }).execute();
        await appDb.db.insertInto('sessions').values({
            activeRunId: null,
            archivedAt: null,
            createdAt: '2026-05-19T00:00:00.000Z',
            id: 'session-1',
            includePartyContext: 1,
            mode: 'assistant',
            title: 'Temporary Session',
            updatedAt: '2026-05-19T00:00:00.000Z',
        }).execute();

        chat = {
            complete: vi.fn(),
            completeStructured: vi.fn(),
        };
        partyContext = {
            build: vi.fn().mockResolvedValue('Current party context:\n- Party actors: Beren.'),
        };
        retrieval = {
            prepare: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn(),
            search: vi.fn().mockResolvedValue([]),
        } satisfies CorpusRetrievalService;
    });

    afterEach(async () => {
        await appDb.close().catch(() => undefined);
        await rm(TEST_ROOT, {force: true, recursive: true});
    });

    it('persists assistant reasoning and final response for a tool-call run', async () => {
        (chat.completeStructured as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({
                content: '<thinking>Checking Mourning details before answering.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({
                        limit: 2,
                        query: 'mourning causes',
                        userMessage: 'Checking likely causes in the local corpus.',
                    }),
                    id: 'tool-1',
                    name: 'search_corpus',
                }],
            })
            .mockResolvedValueOnce({
                content: [
                    '<response>',
                    '  <session-title>Mourning Leads</session-title>',
                    '  <response-title>Likely causes</response-title>',
                    '  <answer>Supported answer.</answer>',
                    '</response>',
                ].join('\n'),
                kind: 'text',
            });
        (retrieval.search as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        const run = await coordinator.startRun(runRequest());

        expect(run.status).toBe('completed');
        expect(run.sessionEntries.map(entry => entry.kind)).toEqual(['user', 'reasoning', 'response']);
        expect(run.sessionEntries[1]).toMatchObject({
            content: 'Checking Mourning details before answering.',
            kind: 'reasoning',
            toolCallId: 'tool-1',
        });
        expect(run.sessionEntries[2]).toMatchObject({
            content: 'Supported answer.',
            kind: 'response',
            title: 'Likely causes',
        });

        const session = await appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', 'session-1')
            .executeTakeFirstOrThrow();
        expect(session.title).toBe('Mourning Leads');
        expect(session.activeRunId).toBeNull();

        const persistedEntries = await appDb.db
            .selectFrom('sessionEntries')
            .select(['kind', 'content', 'title', 'toolCallId'])
            .where('sessionId', '=', 'session-1')
            .orderBy('sequenceIndex', 'asc')
            .execute();
        expect(persistedEntries).toEqual([
            {content: 'What caused the Mourning?', kind: 'user', title: null, toolCallId: null},
            {content: 'Checking Mourning details before answering.', kind: 'reasoning', title: null, toolCallId: 'tool-1'},
            {content: 'Supported answer.', kind: 'response', title: 'Likely causes', toolCallId: null},
        ]);
    });

    it('preserves the existing session title on later exchanges', async () => {
        await seedExistingExchange(appDb, 'session-1');
        (chat.completeStructured as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            content: [
                '<response>',
                '  <response-title>Follow-up</response-title>',
                '  <answer>Later answer.</answer>',
                '</response>',
            ].join('\n'),
            kind: 'text',
        });

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        const run = await coordinator.startRun(runRequest({prompt: 'Second question'}));

        expect(run.sessionEntries.map(entry => entry.kind)).toEqual(['user', 'response']);
        const session = await appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', 'session-1')
            .executeTakeFirstOrThrow();
        expect(session.title).toBe('Established Title');
    });

    it('rebuilds provider-visible history from persisted user/response entries', async () => {
        await seedExistingExchange(appDb, 'session-1', true);
        (chat.completeStructured as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            content: [
                '<response>',
                '  <response-title>Next step</response-title>',
                '  <answer>Answer.</answer>',
                '</response>',
            ].join('\n'),
            kind: 'text',
        });

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        await coordinator.startRun(runRequest({prompt: 'Continue'}));

        const firstCallMessages = (chat.completeStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<{content: string; role: string}>;
        expect(firstCallMessages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(firstCallMessages[1]?.content).toBe('Earlier question');
        expect(firstCallMessages[2]?.content).toBe('Earlier answer');
        expect(firstCallMessages.some(message => message.content.includes('Earlier reasoning'))).toBe(false);
    });

    it('includes party context only when the run requests it', async () => {
        (chat.completeStructured as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            content: [
                '<response>',
                '  <session-title>Context Test</session-title>',
                '  <response-title>World state</response-title>',
                '  <answer>Answer.</answer>',
                '</response>',
            ].join('\n'),
            kind: 'text',
        });

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        await coordinator.startRun(runRequest({includePartyContext: false}));

        const firstCallMessages = (chat.completeStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<{content: string; role: string}>;
        expect(firstCallMessages.at(-1)?.content).not.toContain('Current party context:');
        expect(partyContext.build).not.toHaveBeenCalled();
    });

    it('marks failed runs durable and clears activeRunId when response repair fails', async () => {
        (chat.completeStructured as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            content: 'not valid xml',
            kind: 'text',
        });
        (chat.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce('still invalid');

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        await expect(coordinator.startRun(runRequest())).rejects.toMatchObject({
            kind: 'run-invalid-response',
        });

        const run = await appDb.db
            .selectFrom('runs')
            .selectAll()
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('failed');
        expect(run.error).toContain('required V2 response envelope');

        const session = await appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', 'session-1')
            .executeTakeFirstOrThrow();
        expect(session.activeRunId).toBeNull();

        const entries = await appDb.db
            .selectFrom('sessionEntries')
            .select(['kind', 'content'])
            .where('sessionId', '=', 'session-1')
            .orderBy('sequenceIndex', 'asc')
            .execute();
        expect(entries).toEqual([
            {content: 'What caused the Mourning?', kind: 'user'},
        ]);
    });

    it('blocks runs while refresh is active', async () => {
        await appDb.db
            .updateTable('refreshState')
            .set({
                activeOperation: 'refresh',
                refreshStatus: 'running',
                updatedAt: '2026-05-19T00:00:01.000Z',
            })
            .where('singletonKey', '=', 1)
            .execute();

        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        await expect(coordinator.startRun(runRequest())).rejects.toMatchObject({
            kind: 'run-blocked-refresh',
        });
        await expect(appDb.db.selectFrom('runs').select('id').execute()).resolves.toEqual([]);
    });

    it('rejects missing and unsupported session inputs', async () => {
        const coordinator = createRunCoordinator({
            appDb,
            chat,
            loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
            partyContext,
            retrieval,
            retrievalDir: path.join(TEST_ROOT, 'retrieval'),
        });

        await expect(coordinator.startRun(runRequest({sessionId: undefined}))).rejects.toMatchObject({
            kind: 'run-session-required',
        });
        await expect(coordinator.startRun(runRequest({mode: 'npc'}))).rejects.toMatchObject({
            kind: 'run-unsupported-mode',
        });
        await expect(coordinator.startRun(runRequest({sessionId: 'missing'}))).rejects.toMatchObject({
            kind: 'run-session-missing',
        });
    });
});

describe('V2 runs API route', () => {
    let appDb: Awaited<ReturnType<typeof createAppDb>>;
    let chat: ChatAdapter;
    let partyContext: PartyContextService;
    let retrieval: CorpusRetrievalService;

    beforeEach(async () => {
        await rm(TEST_ROOT, {force: true, recursive: true});
        appDb = await createAppDb(getDefaultAppDatabasePath(TEST_ROOT));
        await initializeRefreshState(appDb);
        await appDb.db.insertInto('settings').values({
            key: settingKeys.additionalContext,
            modifiedAt: '2026-05-19T00:00:00.000Z',
            value: '# Additional Context',
        }).execute();
        await appDb.db.insertInto('sessions').values({
            activeRunId: null,
            archivedAt: null,
            createdAt: '2026-05-19T00:00:00.000Z',
            id: 'session-1',
            includePartyContext: 1,
            mode: 'assistant',
            title: 'Temporary Session',
            updatedAt: '2026-05-19T00:00:00.000Z',
        }).execute();

        chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({
                content: [
                    '<response>',
                    '  <session-title>API Session</session-title>',
                    '  <response-title>API Heading</response-title>',
                    '  <answer>API answer.</answer>',
                    '</response>',
                ].join('\n'),
                kind: 'text',
            }),
        };
        partyContext = {
            build: vi.fn().mockResolvedValue('Current party context:\n- Party actors: Beren.'),
        };
        retrieval = {
            prepare: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn(),
            search: vi.fn().mockResolvedValue([]),
        } satisfies CorpusRetrievalService;
    });

    afterEach(async () => {
        await appDb.close().catch(() => undefined);
        await rm(TEST_ROOT, {force: true, recursive: true});
    });

    it('posts a run, returns persisted entries, and survives reopen', async () => {
        const app = createTestApp(appDb, chat, partyContext, retrieval);
        const request = createJsonRequest('POST', '/api/v2/runs', runRequest());
        const {record, response} = createResponse();

        createV2ApiHandler(app)(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(200);
        const run = JSON.parse(record.body) as {sessionEntries: Array<{kind: string}>};
        expect(run.sessionEntries.map(entry => entry.kind)).toEqual(['user', 'response']);

        await app.close();
        const reopened = await createAppDb(getDefaultAppDatabasePath(TEST_ROOT));
        try {
            const feedEntries = await reopened.db
                .selectFrom('sessionEntries')
                .select(['kind', 'content'])
                .where('sessionId', '=', 'session-1')
                .orderBy('sequenceIndex', 'asc')
                .execute();
            expect(feedEntries).toEqual([
                {content: 'What caused the Mourning?', kind: 'user'},
                {content: 'API answer.', kind: 'response'},
            ]);
        } finally {
            await reopened.close();
        }
    });

    it('returns a conflict error when refresh is active', async () => {
        await appDb.db
            .updateTable('refreshState')
            .set({
                activeOperation: 'refresh',
                refreshStatus: 'running',
                updatedAt: '2026-05-19T00:00:01.000Z',
            })
            .where('singletonKey', '=', 1)
            .execute();

        const app = createTestApp(appDb, chat, partyContext, retrieval);
        const request = createJsonRequest('POST', '/api/v2/runs', runRequest());
        const {record, response} = createResponse();

        createV2ApiHandler(app)(request, response);
        await flushAsyncHandlers();

        expect(record.statusCode).toBe(409);
        expect(JSON.parse(record.body)).toEqual({
            error: 'Runs are blocked while refresh or reingest is active.',
        });
    });
});

const createTestApp = (
    appDb: Awaited<ReturnType<typeof createAppDb>>,
    chat: ChatAdapter,
    partyContext: PartyContextService,
    retrieval: CorpusRetrievalService,
): V2AppContext => ({
    close: appDb.close,
    consoleEvents: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        snapshot: vi.fn(),
        subscribe: vi.fn().mockReturnValue(() => undefined),
        warn: vi.fn(),
    },
    db: appDb.db,
    refreshCoordinator: {
        startRefresh: vi.fn(),
    },
    runCoordinator: createRunCoordinator({
        appDb,
        chat,
        loadPromptAssets: () => Promise.resolve(PROMPT_ASSETS),
        partyContext,
        retrieval,
        retrievalDir: path.join(TEST_ROOT, 'retrieval'),
    }),
    runtimeEvents: {
        publish: vi.fn(),
        publishRefreshEvent: vi.fn(),
        subscribe: vi.fn().mockReturnValue(() => undefined),
    },
});

const runRequest = (overrides: Partial<CreateRunDto> = {}): CreateRunDto => ({
    includePartyContext: true,
    mode: 'assistant',
    prompt: 'What caused the Mourning?',
    retrievalTurnLimit: 1,
    sessionId: 'session-1',
    ...overrides,
});

const initializeRefreshState = async (appDb: Awaited<ReturnType<typeof createAppDb>>): Promise<void> => {
    await appDb.db.insertInto('refreshState').values({
        activeOperation: null,
        createdAt: '2026-05-19T00:00:00.000Z',
        lastRefreshAt: null,
        lastReingestAt: null,
        refreshStatus: 'completed',
        reingestStatus: 'completed',
        singletonKey: 1,
        updatedAt: '2026-05-19T00:00:00.000Z',
    }).execute();
};

const seedExistingExchange = async (
    appDb: Awaited<ReturnType<typeof createAppDb>>,
    sessionId: string,
    includeReasoning = false,
): Promise<void> => {
    await appDb.db
        .updateTable('sessions')
        .set({
            title: 'Established Title',
            updatedAt: '2026-05-19T00:00:30.000Z',
        })
        .where('id', '=', sessionId)
        .execute();
    await appDb.db.insertInto('runs').values({
        completedAt: '2026-05-19T00:00:20.000Z',
        createdAt: '2026-05-19T00:00:10.000Z',
        error: null,
        failedAt: null,
        id: 'run-existing',
        includePartyContext: 1,
        mode: 'assistant',
        prompt: 'Earlier question',
        retrievalTurnLimit: 1,
        sessionId,
        startedAt: '2026-05-19T00:00:10.000Z',
        status: 'completed',
        updatedAt: '2026-05-19T00:00:20.000Z',
    }).execute();

    const entries: Array<{
        content: string;
        createdAt: string;
        id: string;
        kind: 'reasoning' | 'response' | 'user';
        runId: string;
        sequenceIndex: number;
        sessionId: string;
        title: string | null;
        toolCallId: string | null;
    }> = [{
        content: 'Earlier question',
        createdAt: '2026-05-19T00:00:10.000Z',
        id: 'entry-user',
        kind: 'user',
        runId: 'run-existing',
        sequenceIndex: 1,
        sessionId,
        title: null,
        toolCallId: null,
    }];

    if (includeReasoning) {
        entries.push({
            content: 'Earlier reasoning',
            createdAt: '2026-05-19T00:00:12.000Z',
            id: 'entry-reasoning',
            kind: 'reasoning',
            runId: 'run-existing',
            sequenceIndex: 2,
            sessionId,
            title: null,
            toolCallId: 'tool-old',
        });
    }

    entries.push({
        content: 'Earlier answer',
        createdAt: '2026-05-19T00:00:20.000Z',
        id: 'entry-response',
        kind: 'response',
        runId: 'run-existing',
        sequenceIndex: includeReasoning ? 3 : 2,
        sessionId,
        title: 'Earlier heading',
        toolCallId: null,
    });

    await appDb.db.insertInto('sessionEntries').values(entries).execute();
};
