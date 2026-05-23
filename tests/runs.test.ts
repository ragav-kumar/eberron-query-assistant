import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsStore } from '@server/db/app/index.js';
import { createRunCoordinator } from '@server/services/run-coordinator.js';

import { createInMemoryAppDb } from './support/app-db.js';

describe('V2 run coordinator', () => {
    let appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>;

    beforeEach(async () => {
        appDb = await createInMemoryAppDb();
        await insertSession(appDb, { id: 'session-1', mode: 'assistant', title: 'Original title' });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await appDb.destroy();
    });

    it('rejects empty prompts after trimming', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun({
            includePartyContext: false,
            mode: 'assistant',
            prompt: '   ',
            retrievalTurnLimit: 1,
            sessionId: 'session-1',
        })).rejects.toThrow('Assistant prompt cannot be empty.');
    });

    it('clamps retrievalTurnLimit to configured bounds', async () => {
        const coordinator = createCoordinator(appDb);

        await coordinator.startRun(createRequest({
            prompt: 'Ask about Sharn',
            retrievalTurnLimit: 999,
        }));

        const run = await appDb.db.selectFrom('runs').selectAll().executeTakeFirstOrThrow();
        expect(run.retrievalTurnLimit).toBe(settingsStore().read('retrievalMaxToolTurns'));
    });

    it('blocks runs while refresh is active', async () => {
        await appDb.db.insertInto('refreshState').values({
            activeOperation: 'refresh',
            createdAt: '2026-05-20T00:00:00.000Z',
            lastRefreshAt: null,
            lastReingestAt: null,
            refreshStatus: 'running',
            reingestStatus: 'failed',
            singletonKey: 1,
            updatedAt: '2026-05-20T00:00:00.000Z',
        }).execute();
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest())).rejects.toThrow('Runs are blocked while refresh or reingest is active.');
    });

    it('requires a persisted session during phase 1 assistant runs', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun({
            includePartyContext: false,
            mode: 'assistant',
            prompt: 'Question',
            retrievalTurnLimit: 1,
            sessionId: undefined,
        })).rejects.toThrow('A persisted sessionId is required for V2 runs in Phase 1.');
    });

    it('rejects unsupported run modes', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun({
            includePartyContext: false,
            mode: 'npc',
            prompt: 'Question',
            retrievalTurnLimit: 1,
            sessionId: 'session-1',
        })).rejects.toThrow('Only assistant runs are supported in Phase 1.');
    });

    it('rejects missing sessions', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest({ sessionId: 'missing-session' }))).rejects.toThrow('does not exist');
    });

    it('rejects session mode mismatches', async () => {
        await appDb.db.deleteFrom('sessions').where('id', '=', 'session-1').execute();
        await insertSession(appDb, { id: 'session-1', mode: 'npc', title: 'NPC session' });
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest())).rejects.toThrow('does not support assistant runs');
    });

    it('persists the run row session row update and user entry before model execution', async () => {
        const retrieval = {
            prepare: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn(),
            search: vi.fn().mockImplementation(async () => {
                const run = await appDb.db.selectFrom('runs').selectAll().executeTakeFirstOrThrow();
                const session = await appDb.db.selectFrom('sessions').selectAll().where('id', '=', 'session-1').executeTakeFirstOrThrow();
                const entries = await appDb.db.selectFrom('sessionEntries').selectAll().orderBy('sequenceIndex', 'asc').execute();

                expect(run.status).toBe('running');
                expect(session.activeRunId).toBe(run.id);
                expect(entries).toHaveLength(1);
                expect(entries[0]?.kind).toBe('user');
                return [];
            }),
        };
        const coordinator = createCoordinator(appDb, { retrieval });

        await coordinator.startRun(createRequest());
    });

    it('persists reasoning entries in sequence order as tool calls arrive', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Need more evidence.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ query: 'Sharn towers', userMessage: 'Searching' }),
                    id: 'tool-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: '<response><session-title>Session title</session-title><response-title>Resp</response-title><answer>Final answer</answer></response>',
                kind: 'text',
            },
        ]);
        const coordinator = createCoordinator(appDb, { chat });

        await coordinator.startRun(createRequest());

        const entries = await appDb.db.selectFrom('sessionEntries').selectAll().orderBy('sequenceIndex', 'asc').execute();
        expect(entries.map(entry => entry.kind)).toEqual(['user', 'reasoning', 'response']);
        expect(entries[1]?.toolCallId).toBe('tool-1');
    });

    it('persists the final response entry and clears activeRunId on success', async () => {
        const coordinator = createCoordinator(appDb);

        const run = await coordinator.startRun(createRequest());

        const session = await appDb.db.selectFrom('sessions').selectAll().where('id', '=', 'session-1').executeTakeFirstOrThrow();
        const persistedRun = await appDb.db.selectFrom('runs').selectAll().where('id', '=', run.id).executeTakeFirstOrThrow();
        expect(session.activeRunId).toBeNull();
        expect(persistedRun.status).toBe('completed');
        expect(run.sessionEntries.at(-1)).toMatchObject({ kind: 'response' });
    });

    it('updates the session title only on the first assistant response', async () => {
        const coordinator = createCoordinator(appDb);

        await coordinator.startRun(createRequest());

        const session = await appDb.db.selectFrom('sessions').selectAll().where('id', '=', 'session-1').executeTakeFirstOrThrow();
        expect(session.title).toBe('Session title');
    });

    it('preserves the existing session title on later runs', async () => {
        const coordinator = createCoordinator(appDb);
        await coordinator.startRun(createRequest());

        await coordinator.startRun(createRequest({ prompt: 'Second question' }));

        const runs = await appDb.db.selectFrom('runs').selectAll().orderBy('createdAt', 'asc').execute();
        const session = await appDb.db.selectFrom('sessions').selectAll().where('id', '=', 'session-1').executeTakeFirstOrThrow();
        expect(runs).toHaveLength(2);
        expect(session.title).toBe('Session title');
    });

    it('records failed runs and clears activeRunId when execution throws', async () => {
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockRejectedValue(new Error('provider exploded')),
        };
        const coordinator = createCoordinator(appDb, { chat });

        await expect(coordinator.startRun(createRequest())).rejects.toThrow('provider exploded');

        const run = await appDb.db.selectFrom('runs').selectAll().executeTakeFirstOrThrow();
        const session = await appDb.db.selectFrom('sessions').selectAll().where('id', '=', 'session-1').executeTakeFirstOrThrow();
        expect(run.status).toBe('failed');
        expect(run.error).toContain('provider exploded');
        expect(session.activeRunId).toBeNull();
    });

    it('requests party context from the corpus service only when enabled', async () => {
        const partyContext = { build: vi.fn().mockResolvedValue('Current party context:\n- Party is here.') };
        const coordinator = createCoordinator(appDb, { partyContext });

        await coordinator.startRun(createRequest({ includePartyContext: true }));
        await coordinator.startRun(createRequest({ includePartyContext: false, prompt: 'Without party context' }));

        expect(partyContext.build).toHaveBeenCalledTimes(1);
        expect(partyContext.build).toHaveBeenCalledWith('.retrieval');
    });
});

const createCoordinator = (
    appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>,
    overrides: {
    chat?: {
        complete: ReturnType<typeof vi.fn>;
        completeStructured: ReturnType<typeof vi.fn>;
    };
    partyContext?: { build: ReturnType<typeof vi.fn> };
    retrieval?: {
        prepare: ReturnType<typeof vi.fn>;
        refresh: ReturnType<typeof vi.fn>;
        search: ReturnType<typeof vi.fn>;
    };
} = {},
) => createRunCoordinator({
    appDb,
    chat: overrides.chat ?? {
        complete: vi.fn(),
        completeStructured: vi.fn().mockResolvedValue({
            content: [
                '<response>',
                '  <session-title>Session title</session-title>',
                '  <response-title>Resp</response-title>',
                '  <answer>Final answer</answer>',
                '</response>',
            ].join('\n'),
            kind: 'text',
        }),
    },
    partyContext: overrides.partyContext ?? { build: vi.fn().mockResolvedValue('Current party context:\n- Party is here.') },
    retrieval: overrides.retrieval ?? {
        prepare: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
    },
    retrievalDir: '.retrieval',
    runtimeEvents: {
        publish: vi.fn(),
        publishRefreshEvent: vi.fn(),
        subscribe: vi.fn().mockReturnValue(vi.fn()),
    },
});

const createRequest = (overrides: Partial<{
    includePartyContext: boolean;
    mode: 'assistant' | 'npc';
    prompt: string;
    retrievalTurnLimit: number;
    sessionId: string | undefined;
}> = {}) => ({
    includePartyContext: overrides.includePartyContext ?? true,
    mode: overrides.mode ?? 'assistant',
    prompt: overrides.prompt ?? 'Ask about Sharn',
    retrievalTurnLimit: overrides.retrievalTurnLimit ?? 1,
    sessionId: overrides.sessionId ?? 'session-1',
});

const createSequencedChat = (responses: Array<{ content: string; kind: 'text' | 'tool-calls'; toolCalls?: Array<{ arguments: string; id: string; name: string }> }>) => ({
    complete: vi.fn(),
    completeStructured: vi.fn().mockImplementation(() => {
        const next = responses.shift();
        if (!next) {
            throw new Error('Unexpected extra completeStructured call.');
        }
        return Promise.resolve(next);
    }),
});

const insertSession = async (
    appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>,
    session: {
        id: string;
        mode: 'assistant' | 'npc';
        title: string;
    },
) => {
    const now = '2026-05-20T00:00:00.000Z';
    await appDb.db.insertInto('sessions').values({
        activeRunId: null,
        archivedAt: null,
        createdAt: now,
        id: session.id,
        includePartyContext: 0,
        mode: session.mode,
        title: session.title,
        updatedAt: now,
    }).execute();
};
