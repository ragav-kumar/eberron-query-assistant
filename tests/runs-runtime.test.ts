import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RetrievalResult } from '@/types.js';
import { settingsStore } from '@server/db/app/index.js';
import {
    buildAssistantMessages,
    buildChatHistoryFromSessionEntries,
    buildNpcMessages,
    executeAssistantRun,
    executeNpcRun,
    loadNpcPromptAssets,
    loadPromptAssets,
    NpcPromptAssets,
    PromptAssets,
} from '@server/services/run/index.js';

import { createInMemoryAppDb } from './support/app-db.js';

describe('V2 run runtime', () => {
    let appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>;

    beforeEach(async () => {
        appDb = await createInMemoryAppDb();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await appDb.destroy();
    });

    it('loads assistant prompt assets from tracked markdown files', async () => {
        const assets = await loadPromptAssets();

        expect(assets.shared.length).toBeGreaterThan(0);
        expect(assets.assistant.length).toBeGreaterThan(0);
        expect(assets.sessionTitling.length).toBeGreaterThan(0);
    });

    it('builds assistant messages with shared prompt assistant prompt optional session titling and additional context', () => {
        const messages = buildAssistantMessages({
            additionalContext: 'Local note',
            evidence: [createEvidence('One source', 'Found fact')],
            history: [{ content: 'Earlier answer', role: 'assistant' }],
            includePartyContext: true,
            partyContext: 'Current party context:\n- The party is in Sharn.',
            prompt: 'Where are they?',
            promptAssets: createPromptAssets(),
            requestSessionTitle: true,
            retrievalTurnLimit: 2,
        });

        expect(messages[0]?.role).toBe('system');
        expect(messages[0]?.content).toContain('Shared instructions');
        expect(messages[0]?.content).toContain('Assistant instructions');
        expect(messages[0]?.content).toContain('Title instructions');
        expect(messages[0]?.content).toContain('Additional assistant context:\nLocal note');
        expect(messages[2]?.content).toContain('Current party context:');
        expect(messages[2]?.content).toContain('Retrieved evidence:');
        expect(messages[2]?.content).toContain('Question: Where are they?');
    });

    it('includes explicit omitted-party-context instruction when party context is disabled', () => {
        const messages = buildAssistantMessages({
            additionalContext: '',
            evidence: [],
            history: [],
            includePartyContext: false,
            partyContext: 'Should be omitted',
            prompt: 'Question',
            promptAssets: createPromptAssets(),
            requestSessionTitle: false,
            retrievalTurnLimit: 0,
        });

        expect(messages[0]?.content).toContain('Party context is intentionally omitted for this run.');
        expect(messages[1]?.content).not.toContain('Should be omitted');
    });

    it('formats initial retrieval evidence into the user message', () => {
        const messages = buildAssistantMessages({
            additionalContext: '',
            evidence: [createEvidence('Sharn: Towers', 'The city rises in vertical wards.')],
            history: [],
            includePartyContext: false,
            partyContext: '',
            prompt: 'What is Sharn?',
            promptAssets: createPromptAssets(),
            requestSessionTitle: false,
            retrievalTurnLimit: 1,
        });

        expect(messages[1]?.content).toContain('[1] Sharn: Towers');
        expect(messages[1]?.content).toContain('Match: lexical');
        expect(messages[1]?.content).toContain('The city rises in vertical wards.');
    });

    it('returns a final response when the first structured reply is already valid', async () => {
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({
                content: toFinalEnvelope('Answer body', 'Resp title', 'Session title'),
                kind: 'text',
            }),
        };
        const retrieval = { search: vi.fn().mockResolvedValue([]) };

        const result = await executeAssistantRun(createRunDependencies({
            chat,
            retrieval,
        }));

        expect(result.response.content).toBe('Answer body');
        expect(result.response.kind).toBe('response');
        expect(result.response.title).toBe('Resp title');
        expect(result.sessionTitle).toBe('Session title');
        expect(chat.complete).not.toHaveBeenCalled();
    });

    it('repairs an invalid final envelope once before failing', async () => {
        const chat = {
            complete: vi.fn().mockResolvedValue(toFinalEnvelope('Repaired body', 'Resp title', 'Session title')),
            completeStructured: vi.fn().mockResolvedValue({
                content: '<response>missing nested tags</response>',
                kind: 'text',
            }),
        };
        const retrieval = { search: vi.fn().mockResolvedValue([]) };

        const result = await executeAssistantRun(createRunDependencies({
            chat,
            retrieval,
        }));

        expect(chat.complete).toHaveBeenCalledTimes(1);
        expect(result.response.content).toBe('Repaired body');
        expect(result.sessionTitle).toBe('Session title');
    });

    it('skips reasoning entry and continues when a tool-call reply omits a thinking block', async () => {
        const chat = createSequencedChat([
            {
                content: '',
                kind: 'tool-calls',
                toolCalls: [{ arguments: JSON.stringify({ query: 'Sharn', userMessage: 'Searching' }), id: 'call-1', name: 'search_corpus' }],
            },
            { content: toFinalEnvelope('Answer', 'Resp title', 'Session title'), kind: 'text' },
        ]);
        const deps = createRunDependencies({
            chat,
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        });

        const result = await executeAssistantRun(deps);

        expect(deps.callbacks.onReasoning).not.toHaveBeenCalled();
        expect(result.response.content).toBe('Answer');
    });

    it('consumes retrieval turns only for valid search_corpus calls', async () => {
        const retrieval = { search: vi.fn().mockResolvedValue([]) };
        const chat = createSequencedChat([
            {
                content: '<thinking>Need more evidence.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ query: 'Sharn towers', userMessage: 'Searching' }),
                    id: 'call-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval,
        }));

        expect(retrieval.search).toHaveBeenCalledTimes(2);
        expect(retrieval.search.mock.calls[1]?.[0]).toMatchObject({
            limit: 8,
            query: 'Sharn towers',
        });
    });

    it('returns tool errors for unsupported tool names', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Try the wrong tool.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{ arguments: '{}', id: 'call-1', name: 'wrong_tool' }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        }));

        const secondCallMessages = getChatMessages(chat.completeStructured, 1);
        const toolMessage = secondCallMessages.find(message => message.role === 'tool');
        expect(toolMessage?.content).toContain('unsupported tool "wrong_tool"');
    });

    it('returns tool errors for invalid tool-call JSON', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Try invalid JSON.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{ arguments: '{', id: 'call-1', name: 'search_corpus' }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        }));

        const toolMessage = getChatMessages(chat.completeStructured, 1)
            .find(message => message.role === 'tool');
        expect(toolMessage?.content).toContain('tool arguments must be valid JSON');
    });

    it('returns tool errors for missing query or userMessage', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Missing query.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ userMessage: 'Searching' }),
                    id: 'call-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        }));

        const toolMessage = getChatMessages(chat.completeStructured, 1)
            .find(message => message.role === 'tool');
        expect(toolMessage?.content).toContain('query is required');
    });

    it('enforces sourceTypes validation', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Invalid source type.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ query: 'foo', sourceTypes: ['bad'], userMessage: 'Searching' }),
                    id: 'call-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        }));

        const toolMessage = getChatMessages(chat.completeStructured, 1)
            .find(message => message.role === 'tool');
        expect(toolMessage?.content).toContain('sourceTypes must contain only foundry, pdf, or article');
    });

    it('clamps evidence limit per tool call', async () => {
        const retrieval = { search: vi.fn().mockResolvedValue([]) };
        const chat = createSequencedChat([
            {
                content: '<thinking>Large limit.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ limit: 999, query: 'foo', userMessage: 'Searching' }),
                    id: 'call-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            retrieval,
        }));

        const secondSearchRequest = retrieval.search.mock.calls[1]?.[0] as { limit: number };
        expect(secondSearchRequest.limit).toBe(settingsStore().read('retrievalMaxEvidenceResults'));
    });

    it('stops offering tools after retrieval turns are exhausted', async () => {
        const chat = createSequencedChat([
            {
                content: '<thinking>Last turn.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{
                    arguments: JSON.stringify({ query: 'foo', userMessage: 'Searching' }),
                    id: 'call-1',
                    name: 'search_corpus',
                }],
            },
            {
                content: toFinalEnvelope('Done', 'Resp title', 'Session title'),
                kind: 'text',
            },
        ]);

        await executeAssistantRun(createRunDependencies({
            chat,
            inputs: { retrievalTurnLimit: 1 },
            retrieval: { search: vi.fn().mockResolvedValue([]) },
        }));

        const secondCallOptions = getChatOptions(chat.completeStructured, 1);
        expect(secondCallOptions.tools).toBeUndefined();
    });

    it('formats empty retrieval results with the unsupported-answer guidance', () => {
        const messages = buildAssistantMessages({
            additionalContext: '',
            evidence: [],
            history: [],
            includePartyContext: false,
            partyContext: '',
            prompt: 'Unanswerable question',
            promptAssets: createPromptAssets(),
            requestSessionTitle: false,
            retrievalTurnLimit: 0,
        });

        expect(messages[1]?.content).toContain('No relevant retrieval results were found.');
        expect(messages[1]?.content).toContain('not supported by the local corpus');
    });

    it('omits historical reasoning entries from reconstructed chat history', () => {
        expect(buildChatHistoryFromSessionEntries([
            { content: 'User prompt', kind: 'user' },
            { content: 'Hidden reasoning', kind: 'reasoning' },
            { content: 'Assistant answer', kind: 'response' },
        ])).toEqual([
            { content: 'User prompt', role: 'user' },
            { content: 'Assistant answer', role: 'assistant' },
        ]);
    });

    it('loads npc prompt assets from tracked markdown files', async () => {
        const assets = await loadNpcPromptAssets();

        expect(assets.shared.length).toBeGreaterThan(0);
        expect(assets.npc.length).toBeGreaterThan(0);
        expect(assets.sessionTitling.length).toBeGreaterThan(0);
    });

    it('builds npc messages with the npc prompt instead of the assistant prompt', () => {
        const messages = buildNpcMessages({
            additionalContext: '',
            evidence: [],
            history: [],
            includePartyContext: false,
            partyContext: '',
            prompt: 'Generate a guard',
            promptAssets: createNpcPromptAssets(),
            requestSessionTitle: false,
            retrievalTurnLimit: 0,
        });

        expect(messages[0]?.role).toBe('system');
        expect(messages[0]?.content).toContain('NPC instructions');
        expect(messages[0]?.content).not.toContain('Assistant instructions');
    });

    it('executeNpcRun returns parsed npc records and stores full xml as response content', async () => {
        const rawXml = [
            '<response>',
            '  <session-title>Guards</session-title>',
            '  <response-title>One guard</response-title>',
            '  <npcs>',
            '    <npc><id>1</id><name>Rael</name><species>Human</species><gender>male</gender><bio>A steady guard.</bio><description>Average build, watchful.</description></npc>',
            '  </npcs>',
            '  <notes>One guard generated.</notes>',
            '</response>',
        ].join('\n');
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({ content: rawXml, kind: 'text' }),
        };

        const result = await executeNpcRun(createNpcRunDependencies({ chat, retrieval: { search: vi.fn().mockResolvedValue([]) } }));

        expect(result.npcs).toHaveLength(1);
        expect(result.npcs[0]).toMatchObject({ name: 'Rael', species: 'Human', gender: 'male', bio: 'A steady guard.' });
        expect(result.response.content).toBe(rawXml);
        expect(result.response.kind).toBe('response');
        expect(result.sessionTitle).toBe('Guards');
    });

    it('executeNpcRun correctly extracts all optional npc fields', async () => {
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({
                content: [
                    '<response>',
                    '  <session-title>Crew</session-title>',
                    '  <response-title>Dockworker</response-title>',
                    '  <npcs>',
                    '    <npc>',
                    '      <id>1</id><name>Gorrak</name><species>Half-Orc</species>',
                    '      <ethnicity>Lhazaar</ethnicity><gender>male</gender>',
                    '      <role>Dockworker</role><age>34</age>',
                    '      <bio>Weathered.</bio><description>Thick arms.</description>',
                    '    </npc>',
                    '  </npcs>',
                    '  <notes>One dockworker.</notes>',
                    '</response>',
                ].join('\n'),
                kind: 'text',
            }),
        };

        const result = await executeNpcRun(createNpcRunDependencies({ chat, retrieval: { search: vi.fn().mockResolvedValue([]) } }));

        expect(result.npcs[0]).toMatchObject({ name: 'Gorrak', species: 'Half-Orc', ethnicity: 'Lhazaar', gender: 'male', role: 'Dockworker', age: '34' });
    });

    it('executeNpcRun omits optional fields not present in the model response', async () => {
        const chat = {
            complete: vi.fn(),
            completeStructured: vi.fn().mockResolvedValue({
                content: [
                    '<response>',
                    '  <session-title>Mystery</session-title>',
                    '  <response-title>Unknown figure</response-title>',
                    '  <npcs>',
                    '    <npc><id>1</id><name>Stranger</name><bio>Unknown past.</bio><description>Cloaked.</description></npc>',
                    '  </npcs>',
                    '  <notes>No optional fields.</notes>',
                    '</response>',
                ].join('\n'),
                kind: 'text',
            }),
        };

        const result = await executeNpcRun(createNpcRunDependencies({ chat, retrieval: { search: vi.fn().mockResolvedValue([]) } }));

        expect(result.npcs[0]?.name).toBe('Stranger');
        expect(result.npcs[0]?.species).toBeUndefined();
        expect(result.npcs[0]?.age).toBeUndefined();
    });

    it('executeNpcRun handles search_corpus tool calls before producing the final response', async () => {
        const retrieval = { search: vi.fn().mockResolvedValue([]) };
        const chat = createSequencedChat([
            {
                content: '<thinking>Need evidence.</thinking>',
                kind: 'tool-calls',
                toolCalls: [{ arguments: JSON.stringify({ query: 'city guard', userMessage: 'Searching' }), id: 'tc-1', name: 'search_corpus' }],
            },
            {
                content: toNpcEnvelope('Guard', 'Rael', 'Session title'),
                kind: 'text',
            },
        ]);

        const result = await executeNpcRun(createNpcRunDependencies({ chat, retrieval }));

        expect(retrieval.search).toHaveBeenCalledTimes(2);
        expect(result.npcs[0]?.name).toBe('Rael');
    });

    it('executeNpcRun repairs an invalid npc response envelope before failing', async () => {
        const rawXml = toNpcEnvelope('Guard', 'Rael', 'Session title');
        const chat = {
            complete: vi.fn().mockResolvedValue(rawXml),
            completeStructured: vi.fn().mockResolvedValue({ content: '<response>missing nested tags</response>', kind: 'text' }),
        };

        const result = await executeNpcRun(createNpcRunDependencies({ chat, retrieval: { search: vi.fn().mockResolvedValue([]) } }));

        expect(chat.complete).toHaveBeenCalledTimes(1);
        expect(result.npcs[0]?.name).toBe('Rael');
    });
});

const createPromptAssets = (): PromptAssets => ({
    assistant: 'Assistant instructions',
    sessionTitling: 'Title instructions',
    shared: 'Shared instructions',
});

const createNpcPromptAssets = (): NpcPromptAssets => ({
    npc: 'NPC instructions',
    sessionTitling: 'Title instructions',
    shared: 'Shared instructions',
});

const createEvidence = (label: string, content: string): RetrievalResult => ({
    chunkId: 'chunk-1',
    citation: {
        label,
        locator: null,
        sourceType: 'foundry',
        url: null,
    },
    content,
    matchKind: 'lexical',
    score: 0.9,
    sourceId: 'source-1',
    sourceKey: 'source-key',
    sourceTitle: label,
    sourceType: 'foundry',
});

const createRunDependencies = (overrides: {
    chat: {
        complete: ReturnType<typeof vi.fn>;
        completeStructured: ReturnType<typeof vi.fn>;
    };
    inputs?: Partial<{
        additionalContext: string;
        history: Array<{ content: string; role: 'assistant' | 'system' | 'tool' | 'user' }>;
        includePartyContext: boolean;
        partyContext: string;
        prompt: string;
        requestSessionTitle: boolean;
        retrievalTurnLimit: number;
    }>;
    retrieval: {
        search: ReturnType<typeof vi.fn>;
    };
}) => ({
    callbacks: {
        onReasoning: vi.fn(() => Promise.resolve(undefined)),
    },
    context: {
        runId: 'run-1',
        sessionId: 'session-1',
    },
    inputs: {
        additionalContext: overrides.inputs?.additionalContext ?? '',
        history: overrides.inputs?.history ?? [],
        includePartyContext: overrides.inputs?.includePartyContext ?? true,
        partyContext: overrides.inputs?.partyContext ?? 'Current party context:\n- The party is in Sharn.',
        prompt: overrides.inputs?.prompt ?? 'What is Sharn?',
        promptAssets: createPromptAssets(),
        requestSessionTitle: overrides.inputs?.requestSessionTitle ?? true,
        retrievalTurnLimit: overrides.inputs?.retrievalTurnLimit ?? 1,
    },
    services: {
        chat: overrides.chat,
        retrieval: overrides.retrieval,
    },
});

const createSequencedChat = (responses: Array<{ content: string; kind: 'text' | 'tool-calls'; toolCalls?: Array<{ arguments: string; id: string; name: string }> }>) => ({
    complete: vi.fn(),
    completeStructured: vi.fn()
        .mockImplementation(() => {
            const next = responses.shift();
            if (!next) {
                throw new Error('Unexpected extra completeStructured call.');
            }
            return Promise.resolve(next);
        }),
});

const getChatMessages = (
    completeStructured: ReturnType<typeof vi.fn>,
    callIndex: number,
): Array<{ content: string; role: 'assistant' | 'system' | 'tool' | 'user' }> => (
    completeStructured.mock.calls[callIndex]?.[0] as Array<{ content: string; role: 'assistant' | 'system' | 'tool' | 'user' }> ?? []
);

const getChatOptions = (
    completeStructured: ReturnType<typeof vi.fn>,
    callIndex: number,
): { tools?: unknown[] } => (
    completeStructured.mock.calls[callIndex]?.[1] as { tools?: unknown[] } ?? {}
);

const toFinalEnvelope = (answer: string, responseTitle: string, sessionTitle: string): string => [
    '<response>',
    `  <session-title>${sessionTitle}</session-title>`,
    `  <response-title>${responseTitle}</response-title>`,
    `  <answer>${answer}</answer>`,
    '</response>',
].join('\n');

const toNpcEnvelope = (responseTitle: string, npcName: string, sessionTitle: string): string => [
    '<response>',
    `  <session-title>${sessionTitle}</session-title>`,
    `  <response-title>${responseTitle}</response-title>`,
    '  <npcs>',
    `    <npc><id>1</id><name>${npcName}</name><bio>A guard.</bio><description>Tall figure.</description></npc>`,
    '  </npcs>',
    '  <notes>Generated.</notes>',
    '</response>',
].join('\n');

const createNpcRunDependencies = (overrides: {
    chat: {
        complete: ReturnType<typeof vi.fn>;
        completeStructured: ReturnType<typeof vi.fn>;
    };
    inputs?: Partial<{
        additionalContext: string;
        history: Array<{ content: string; role: 'assistant' | 'system' | 'tool' | 'user' }>;
        includePartyContext: boolean;
        partyContext: string;
        prompt: string;
        requestSessionTitle: boolean;
        retrievalTurnLimit: number;
    }>;
    retrieval: {
        search: ReturnType<typeof vi.fn>;
    };
}) => ({
    callbacks: {
        onReasoning: vi.fn(() => Promise.resolve(undefined)),
    },
    context: {
        runId: 'run-1',
        sessionId: 'session-1',
    },
    inputs: {
        additionalContext: overrides.inputs?.additionalContext ?? '',
        history: overrides.inputs?.history ?? [],
        includePartyContext: overrides.inputs?.includePartyContext ?? false,
        partyContext: overrides.inputs?.partyContext ?? '',
        prompt: overrides.inputs?.prompt ?? 'Generate a guard',
        promptAssets: createNpcPromptAssets(),
        requestSessionTitle: overrides.inputs?.requestSessionTitle ?? true,
        retrievalTurnLimit: overrides.inputs?.retrievalTurnLimit ?? 1,
    },
    services: {
        chat: overrides.chat,
        retrieval: overrides.retrieval,
    },
});
