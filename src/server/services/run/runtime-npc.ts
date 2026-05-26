import { readFile } from 'node:fs/promises';

import { createTaggedError } from '@/errors.js';
import { createNoopTimingReporter, TimingContext } from '@/timing.js';
import { NpcDto, SessionEntryReasoningDto } from '@/dto/index.js';
import { RetrievalResult, SourceType } from '@/types.js';
import { settingsStore } from '@server/db/app/index.js';
import {
    buildRetrievalTool,
    buildRetrievalToolInstructions,
    clampRetrievalTurnLimit,
} from '../retrieval-tool.js';
import { ChatAdapter, ChatMessage, ChatStructuredResult } from '../provider/index.js';
import { listPromptAssets } from '@server/prompts/index.js';
import {
    AssistantRunResult,
    executeSearchCorpusToolCall,
    formatEvidence,
    readTag,
} from './runtime.js';

export interface NpcPromptAssets {
    npc: string;
    sessionTitling: string;
    shared: string;
}

/** Parsed NPC data extracted from a model response, omitting DB-assigned and context-supplied fields. */
export type ParsedNpcData = Omit<NpcDto, 'id' | 'sessionId' | 'runId' | 'createdAt' | 'updatedAt'>;

/**
 * Every mode's run result extends AssistantRunResult so that session entry
 * persistence and event publishing in the coordinator can use a single shared
 * code path. NPC mode adds the structured NPC records parsed from the response.
 */
export interface NpcRunResult extends AssistantRunResult {
    npcs: ParsedNpcData[];
}

export interface NpcMessageBuildRequest {
    additionalContext: string;
    evidence: RetrievalResult[];
    history: ChatMessage[];
    includePartyContext: boolean;
    partyContext: string;
    prompt: string;
    promptAssets: NpcPromptAssets;
    requestSessionTitle: boolean;
    retrievalTurnLimit: number;
}

export interface ExecuteNpcRunDependencies {
    context: {
        runId: string;
        sessionId: string;
    };
    inputs: {
        additionalContext: string;
        history: ChatMessage[];
        includePartyContext: boolean;
        partyContext: string;
        prompt: string;
        promptAssets: NpcPromptAssets;
        requestSessionTitle: boolean;
        retrievalTurnLimit: number;
    };
    callbacks: {
        onReasoning: (reasoning: Omit<SessionEntryReasoningDto, 'id'>) => Promise<void>;
    };
    services: {
        chat: ChatAdapter;
        retrieval: {
            search: (request: {
                limit: number;
                query: string;
                sourceKeys?: string[];
                sourceTypes?: SourceType[];
                timing: TimingContext;
            }) => Promise<RetrievalResult[]>;
        };
    };
}

/**
 * Loads the tracked V2 prompt markdown assets needed for NPC generation execution.
 */
export const loadNpcPromptAssets = async (): Promise<NpcPromptAssets> => {
    const promptAssetPaths = listPromptAssets('npc', true);
    const sharedPath = promptAssetPaths[0];
    const sessionTitlingPath = promptAssetPaths[1];
    const npcPath = promptAssetPaths[2];
    if (!sharedPath || !sessionTitlingPath || !npcPath) {
        throw new Error('NPC prompt assets are incomplete.');
    }
    const [shared, sessionTitling, npc] = await Promise.all([
        readFile(sharedPath, 'utf8'),
        readFile(sessionTitlingPath, 'utf8'),
        readFile(npcPath, 'utf8'),
    ]);

    return {
        npc: npc.trim(),
        sessionTitling: sessionTitling.trim(),
        shared: shared.trim(),
    };
};

/**
 * Builds the V2 NPC mode prompt stack around history, retrieval evidence, and
 * the current user prompt. Mirrors buildAssistantMessages with the NPC prompt
 * substituted for the assistant prompt.
 */
export const buildNpcMessages = (request: NpcMessageBuildRequest): ChatMessage[] => {
    const evidence = formatEvidence(request.evidence);
    const systemPromptParts = [
        request.promptAssets.shared,
        request.promptAssets.npc,
        request.requestSessionTitle ? request.promptAssets.sessionTitling : '',
        request.additionalContext.trim().length > 0
            ? ['Additional assistant context:', request.additionalContext.trim()].join('\n')
            : '',
        request.includePartyContext ? '' : 'Party context is intentionally omitted for this run.',
        buildRetrievalToolInstructions(request.retrievalTurnLimit),
    ].filter(part => part.trim().length > 0);

    const userContentParts = [
        request.includePartyContext && request.partyContext.trim().length > 0 ? request.partyContext.trim() : '',
        'Retrieved evidence:',
        evidence,
        '',
        `Question: ${request.prompt.trim()}`,
    ].filter((part, index) => part.length > 0 || index === 2);

    return [
        {
            content: systemPromptParts.join('\n\n'),
            role: 'system',
        },
        ...request.history,
        {
            content: userContentParts.join('\n'),
            role: 'user',
        },
    ];
};

/**
 * Executes one NPC generator run, persisting reasoning blocks through the
 * provided callback and returning the full raw XML as response content so that
 * subsequent exchanges can reconstruct the NPC history from session entries.
 */
export const executeNpcRun = async (
    dependencies: ExecuteNpcRunDependencies,
): Promise<NpcRunResult> => {
    const store = settingsStore();
    const retrievalMaxToolTurns = store.read('retrievalMaxToolTurns');
    const retrievalMaxEvidenceResults = store.read('retrievalMaxEvidenceResults');
    const timing: TimingContext = {
        operation: 'npc',
        operationId: dependencies.context.runId,
        reporter: createNoopTimingReporter(),
    };
    const retrievalTurnLimit = clampRetrievalTurnLimit(
        dependencies.inputs.retrievalTurnLimit,
        retrievalMaxToolTurns,
    );
    const retrievalTool = buildRetrievalTool(retrievalMaxEvidenceResults);
    const initialEvidence = await dependencies.services.retrieval.search({
        limit: retrievalMaxEvidenceResults,
        query: dependencies.inputs.prompt,
        timing,
    });
    const messages = buildNpcMessages({
        additionalContext: dependencies.inputs.additionalContext,
        evidence: initialEvidence,
        history: dependencies.inputs.history,
        includePartyContext: dependencies.inputs.includePartyContext,
        partyContext: dependencies.inputs.partyContext,
        prompt: dependencies.inputs.prompt,
        promptAssets: dependencies.inputs.promptAssets,
        requestSessionTitle: dependencies.inputs.requestSessionTitle,
        retrievalTurnLimit,
    });

    let response = await dependencies.services.chat.completeStructured(
        messages,
        retrievalTurnLimit > 0 ? {tools: [retrievalTool]} : {},
    );
    let remainingTurns = retrievalTurnLimit;

    while (response.kind === 'tool-calls') {
        const thinkingContent = readTag(response.content, 'thinking');
        if (thinkingContent) {
            await dependencies.callbacks.onReasoning({
                content: thinkingContent,
                createdAt: new Date().toISOString(),
                kind: 'reasoning',
                runId: dependencies.context.runId,
                sessionId: dependencies.context.sessionId,
                toolCallId: response.toolCalls[0]?.id ?? null,
            });
        }
        messages.push({
            content: response.content,
            role: 'assistant',
            toolCalls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
            const toolResult = await executeSearchCorpusToolCall({
                maxEvidenceResults: retrievalMaxEvidenceResults,
                remainingTurns,
                retrieval: dependencies.services.retrieval,
                timing,
                toolCall,
            });
            if (toolResult.consumeTurn) {
                remainingTurns -= 1;
            }
            messages.push({
                content: toolResult.content,
                name: toolCall.name,
                role: 'tool',
                toolCallId: toolCall.id,
            });
        }

        response = await dependencies.services.chat.completeStructured(
            messages,
            remainingTurns > 0 ? {tools: [retrievalTool]} : {},
        );
    }

    const finalResponse = await repairNpcResponseIfNeeded({
        chat: dependencies.services.chat,
        expectSessionTitle: dependencies.inputs.requestSessionTitle,
        messages,
        rawResponse: response,
    });

    return {
        npcs: finalResponse.npcs,
        response: {
            content: finalResponse.rawContent,
            createdAt: new Date().toISOString(),
            kind: 'response',
            runId: dependencies.context.runId,
            sessionId: dependencies.context.sessionId,
            title: finalResponse.responseTitle,
        },
        sessionTitle: finalResponse.sessionTitle,
    };
};

interface ParsedNpcResponse {
    npcs: ParsedNpcData[];
    rawContent: string;
    responseTitle: string;
    sessionTitle: string | null;
}

const parseNpcResponse = (rawResponse: string, expectSessionTitle: boolean): ParsedNpcResponse | null => {
    const responseTitle = readTag(rawResponse, 'response-title');
    const npcsBlock = readTag(rawResponse, 'npcs');
    if (!responseTitle || !npcsBlock) {
        return null;
    }

    const sessionTitle = expectSessionTitle ? readTag(rawResponse, 'session-title') : null;
    if (expectSessionTitle && !sessionTitle) {
        return null;
    }

    const npcs = parseNpcBlocks(npcsBlock);
    if (npcs.length === 0) {
        return null;
    }

    return {
        npcs,
        rawContent: rawResponse,
        responseTitle,
        sessionTitle,
    };
};

const parseNpcBlocks = (npcsBlock: string): ParsedNpcData[] => {
    const results: ParsedNpcData[] = [];
    const npcBlockRegex = /<npc>([\s\S]*?)<\/npc>/gi;
    let match: RegExpExecArray | null;

    while ((match = npcBlockRegex.exec(npcsBlock)) !== null) {
        const block = match[1];
        if (!block) continue;

        const name = readTag(block, 'name');
        const bio = readTag(block, 'bio');
        const description = readTag(block, 'description');
        if (!name || !bio || !description) continue;

        results.push({
            age: readTag(block, 'age') ?? undefined,
            bio,
            description,
            ethnicity: readTag(block, 'ethnicity') ?? undefined,
            gender: readTag(block, 'gender') ?? undefined,
            name,
            role: readTag(block, 'role') ?? undefined,
            species: readTag(block, 'species') ?? undefined,
        });
    }

    return results;
};

const repairNpcResponseIfNeeded = async (request: {
    chat: ChatAdapter;
    expectSessionTitle: boolean;
    messages: ChatMessage[];
    rawResponse: ChatStructuredResult;
}): Promise<ParsedNpcResponse> => {
    const parsed = parseNpcResponse(request.rawResponse.content, request.expectSessionTitle);
    if (parsed) {
        return parsed;
    }

    const repaired = await request.chat.complete([
        ...request.messages,
        {content: request.rawResponse.content, role: 'assistant'},
        {
            content: buildNpcMetadataRepairPrompt(request.expectSessionTitle),
            role: 'user',
        },
    ]);
    const repairedParsed = parseNpcResponse(repaired, request.expectSessionTitle);
    if (!repairedParsed) {
        throw createTaggedError('run-invalid-response', 'NPC generator response did not include the required V2 response envelope.');
    }

    return repairedParsed;
};

const buildNpcMetadataRepairPrompt = (expectSessionTitle: boolean): string => [
    'Your previous response was missing required V2 response tags.',
    'Return the same NPC content again using the required XML-like envelope only.',
    expectSessionTitle
        ? 'Include <response>, <session-title>, <response-title>, <npcs> with one or more <npc> elements, and <notes>.'
        : 'Include <response>, <response-title>, <npcs> with one or more <npc> elements, and <notes>. Do not include <session-title>.',
    'Do not add commentary outside the tags.',
].join('\n');
