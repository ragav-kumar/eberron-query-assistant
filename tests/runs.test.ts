import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsStore } from '@server/db/app/index.js';
import { createRunCoordinator } from '@server/services/run/index.js';

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

    it('creates a new persisted session when no sessionId is provided', async () => {
        const coordinator = createCoordinator(appDb);

        const run = await coordinator.startRun({
            includePartyContext: false,
            mode: 'assistant',
            prompt: 'Question',
            retrievalTurnLimit: 1,
            sessionId: undefined,
        });

        const session = await appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', run.sessionId)
            .executeTakeFirst();
        expect(session).toBeDefined();
        expect(session?.mode).toBe('assistant');
        expect(session?.includePartyContext).toBe(0);
        expect(run.sessionId).not.toBe('session-1');
    });

    it('creates a new npc-mode session and persists the run when no sessionId is provided for npc mode', async () => {
        const coordinator = createCoordinator(appDb, { chat: createNpcChat() });

        const run = await coordinator.startRun({
            includePartyContext: false,
            mode: 'npc',
            prompt: 'Generate a guard',
            retrievalTurnLimit: 1,
            sessionId: undefined,
        });

        const session = await appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', run.sessionId)
            .executeTakeFirst();
        expect(session).toBeDefined();
        expect(session?.mode).toBe('npc');
        expect(run.sessionId).not.toBe('session-1');
    });

    it('persists npc records to the npcs table after a successful npc run', async () => {
        await insertSession(appDb, { id: 'npc-session', mode: 'npc', title: '' });
        const coordinator = createCoordinator(appDb, { chat: createNpcChat() });

        await coordinator.startRun({
            includePartyContext: false,
            mode: 'npc',
            prompt: 'Generate a guard',
            retrievalTurnLimit: 0,
            sessionId: 'npc-session',
        });

        const npcs = await appDb.db.selectFrom('npcs').selectAll().execute();
        expect(npcs).toHaveLength(1);
        expect(npcs[0]).toMatchObject({ name: 'Mira Tannen', species: 'Human', sessionId: 'npc-session' });
    });

    it('persists multiple npc records when the response contains several npc elements', async () => {
        await insertSession(appDb, { id: 'npc-session', mode: 'npc', title: '' });
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({
                content: [
                    '<response>',
                    '  <session-title>Guards of Sharn</session-title>',
                    '  <response-title>Two guards</response-title>',
                    '  <npcs>',
                    '    <npc><id>1</id><name>Rael</name><bio>A veteran.</bio><description>Tall human.</description></npc>',
                    '    <npc><id>2</id><name>Sorn</name><species>Half-Orc</species><bio>Gruff.</bio><description>Broad shoulders.</description></npc>',
                    '  </npcs>',
                    '  <notes>Two guards generated.</notes>',
                    '</response>',
                ].join('\n'),
                kind: 'text',
            }),
        };
        const coordinator = createCoordinator(appDb, { chat });

        await coordinator.startRun({
            includePartyContext: false,
            mode: 'npc',
            prompt: 'Generate two guards',
            retrievalTurnLimit: 0,
            sessionId: 'npc-session',
        });

        const npcs = await appDb.db.selectFrom('npcs').selectAll().orderBy('id', 'asc').execute();
        expect(npcs).toHaveLength(2);
        expect(npcs[0]?.name).toBe('Rael');
        expect(npcs[1]?.name).toBe('Sorn');
        expect(npcs[1]?.species).toBe('Half-Orc');
    });

    it('rejects missing sessions', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest({ sessionId: 'missing-session' }))).rejects.toThrow('does not exist');
    });

    it('rejects an assistant run against an npc session', async () => {
        await appDb.db.deleteFrom('sessions').where('id', '=', 'session-1').execute();
        await insertSession(appDb, { id: 'session-1', mode: 'npc', title: 'NPC session' });
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest())).rejects.toThrow('does not support assistant runs');
    });

    it('rejects an npc run against an assistant session', async () => {
        const coordinator = createCoordinator(appDb);

        await expect(coordinator.startRun(createRequest({ mode: 'npc' }))).rejects.toThrow('does not support npc runs');
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

const createNpcChat = () => ({
    complete: vi.fn(),
    completeStructured: vi.fn().mockResolvedValue({
        content: [
            '<response>',
            '  <session-title>Session title</session-title>',
            '  <response-title>One guard</response-title>',
            '  <npcs>',
            '    <npc><id>1</id><name>Mira Tannen</name><species>Human</species><bio>A city guard.</bio><description>Average height, alert eyes.</description></npc>',
            '  </npcs>',
            '  <notes>One guard generated.</notes>',
            '</response>',
        ].join('\n'),
        kind: 'text',
    }),
});
