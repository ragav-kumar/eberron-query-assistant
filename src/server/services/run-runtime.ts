import { readFile } from 'node:fs/promises';

import { createTaggedError } from '@/errors.js';
import { createNoopTimingReporter, type TimingContext } from '@/timing.js';
import type { SessionEntryReasoningDto, SessionEntryResponseDto } from '@/dto/index.js';
import type { RetrievalResult, SourceType } from '@/types.js';
import { settingsStore } from '@server/db/app/index.js';
import {
    buildRetrievalTool,
    buildRetrievalToolInstructions,
    clampRetrievalTurnLimit,
    completeStructured,
    isSourceType,
} from './retrieval-tool.js';
import {
    type ChatAdapter,
    type ChatMessage,
    type ChatStructuredResult,
    type ChatToolCall,
} from './provider.js';

import { listPromptAssets } from '../prompts/index.js';

export interface PromptAssets {
    assistant: string;
    sessionTitling: string;
    shared: string;
}

export interface AssistantMessageBuildRequest {
    additionalContext: string;
    evidence: RetrievalResult[];
    history: ChatMessage[];
    includePartyContext: boolean;
    partyContext: string;
    prompt: string;
    promptAssets: PromptAssets;
    requestSessionTitle: boolean;
    retrievalTurnLimit: number;
}

export interface ExecuteAssistantRunDependencies {
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
        promptAssets: PromptAssets;
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

export interface AssistantRunResult {
    response: Omit<SessionEntryResponseDto, 'id'>;
    sessionTitle: string | null;
}

/**
 * Loads the tracked V2 prompt markdown assets needed for assistant execution.
 */
export const loadPromptAssets = async (): Promise<PromptAssets> => {
    const promptAssetPaths = listPromptAssets('assistant', true);
    const sharedPath = promptAssetPaths[0];
    const sessionTitlingPath = promptAssetPaths[1];
    const assistantPath = promptAssetPaths[2];
    if (!sharedPath || !sessionTitlingPath || !assistantPath) {
        throw new Error('Assistant prompt assets are incomplete.');
    }
    const [shared, sessionTitling, assistant] = await Promise.all([
        readFile(sharedPath, 'utf8'),
        readFile(sessionTitlingPath, 'utf8'),
        readFile(assistantPath, 'utf8'),
    ]);

    return {
        assistant: assistant.trim(),
        sessionTitling: sessionTitling.trim(),
        shared: shared.trim(),
    };
};

/**
 * Rebuilds provider-visible chat history from persisted V2 session entries.
 *
 * Prior visible reasoning entries are intentionally omitted from replay so the
 * model continues from the durable user/answer transcript rather than from old
 * transient progress blurbs.
 */
export const buildChatHistoryFromSessionEntries = (
    entries: Array<{
        content: string;
        kind: 'reasoning' | 'response' | 'user';
    }>,
): ChatMessage[] => entries.flatMap<ChatMessage>((entry) => {
    if (entry.kind === 'user') {
        return [{content: entry.content, role: 'user'}];
    }
    if (entry.kind === 'response') {
        return [{content: entry.content, role: 'assistant'}];
    }

    return [];
});

/**
 * Builds the V2 assistant prompt stack around history, retrieval evidence, and
 * the current user prompt.
 */
export const buildAssistantMessages = (request: AssistantMessageBuildRequest): ChatMessage[] => {
    const evidence = formatEvidence(request.evidence);
    const systemPromptParts = [
        request.promptAssets.shared,
        request.promptAssets.assistant,
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
 * Executes one assistant run, persisting every assistant-authored `<thinking>`
 * block through the provided callback before returning the final `<response>`.
 */
export const executeAssistantRun = async (
    dependencies: ExecuteAssistantRunDependencies,
): Promise<AssistantRunResult> => {
    const store = settingsStore();
    const retrievalMaxToolTurns = store.read('retrievalMaxToolTurns');
    const retrievalMaxEvidenceResults = store.read('retrievalMaxEvidenceResults');
    const timing: TimingContext = {
        operation: 'assistant',
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
    const messages = buildAssistantMessages({
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

    let response = await completeStructured(dependencies.services.chat, messages, {
        debug: {
            operation: timing.operation,
            operationId: timing.operationId,
            purpose: 'assistant',
        },
        ...(retrievalTurnLimit > 0 ? {tools: [retrievalTool]} : {}),
    });
    let remainingTurns = retrievalTurnLimit;

    while (response.kind === 'tool-calls') {
        const thinking = parseThinkingResponse(response.content);
        if (!thinking) {
            throw createTaggedError('run-invalid-thinking', 'Assistant tool call response did not include a valid <thinking> block.');
        }
        await dependencies.callbacks.onReasoning({
            content: thinking.content,
            createdAt: new Date().toISOString(),
            kind: 'reasoning',
            runId: dependencies.context.runId,
            sessionId: dependencies.context.sessionId,
            toolCallId: response.toolCalls[0]?.id ?? null,
        });
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

        response = await completeStructured(dependencies.services.chat, messages, {
            debug: {
                operation: timing.operation,
                operationId: timing.operationId,
                purpose: 'assistant',
            },
            ...(remainingTurns > 0 ? {tools: [retrievalTool]} : {}),
        });
    }

    const finalResponse = await repairStructuredResponseIfNeeded({
        chat: dependencies.services.chat,
        expectSessionTitle: dependencies.inputs.requestSessionTitle,
        messages,
        rawResponse: response,
        timing,
    });

    return {
        response: {
            content: finalResponse.answer,
            createdAt: new Date().toISOString(),
            kind: 'response',
            runId: dependencies.context.runId,
            sessionId: dependencies.context.sessionId,
            title: finalResponse.responseTitle,
        },
        sessionTitle: finalResponse.sessionTitle,
    };
};

interface ParsedThinkingResponse {
    content: string;
}

interface ParsedFinalResponse {
    answer: string;
    responseTitle: string;
    sessionTitle: string | null;
}

interface SearchCorpusToolArgs {
    limit: number;
    query: string;
    sourceKeys?: string[];
    sourceTypes?: SourceType[];
    userMessage: string;
}

const parseThinkingResponse = (rawResponse: string): ParsedThinkingResponse | null => {
    const content = readTag(rawResponse, 'thinking');
    if (!content) {
        return null;
    }

    return {content};
};

const parseFinalResponse = (rawResponse: string, expectSessionTitle: boolean): ParsedFinalResponse | null => {
    const responseBody = readTag(rawResponse, 'response');
    const responseTitle = readTag(rawResponse, 'response-title');
    const answer = readTag(rawResponse, 'answer');
    if (!responseBody || !responseTitle || !answer) {
        return null;
    }

    const sessionTitle = expectSessionTitle ? readTag(rawResponse, 'session-title') : null;
    if (expectSessionTitle && !sessionTitle) {
        return null;
    }

    return {
        answer,
        responseTitle,
        sessionTitle,
    };
};

const readTag = (text: string, tagName: string): string | null => {
    const match = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i').exec(text);
    const content = match?.[1]?.trim();
    return content && content.length > 0 ? content : null;
};

const repairStructuredResponseIfNeeded = async (request: {
    chat: ChatAdapter;
    expectSessionTitle: boolean;
    messages: ChatMessage[];
    rawResponse: ChatStructuredResult;
    timing: TimingContext;
}): Promise<ParsedFinalResponse> => {
    const parsed = parseFinalResponse(request.rawResponse.content, request.expectSessionTitle);
    if (parsed) {
        return parsed;
    }

    const repaired = await request.chat.complete([
        ...request.messages,
        {content: request.rawResponse.content, role: 'assistant'},
        {
            content: buildMetadataRepairPrompt(request.expectSessionTitle),
            role: 'user',
        },
    ], {
        debug: {
            operation: request.timing.operation,
            operationId: request.timing.operationId,
            purpose: 'assistant-metadata-repair',
        },
    });
    const repairedParsed = parseFinalResponse(repaired, request.expectSessionTitle);
    if (!repairedParsed) {
        throw createTaggedError('run-invalid-response', 'Assistant response did not include the required V2 response envelope.');
    }

    return repairedParsed;
};

const buildMetadataRepairPrompt = (expectSessionTitle: boolean): string => [
    'Your previous response was missing required V2 response tags.',
    'Return the same final answer content again using the required XML-like envelope only.',
    expectSessionTitle
        ? 'Include <response>, <session-title>, <response-title>, and <answer>.'
        : 'Include <response>, <response-title>, and <answer>. Do not include <session-title>.',
    'Do not add commentary outside the tags.',
].join('\n');

const executeSearchCorpusToolCall = async (request: {
    maxEvidenceResults: number;
    remainingTurns: number;
    retrieval: ExecuteAssistantRunDependencies['services']['retrieval'];
    timing: TimingContext;
    toolCall: ChatToolCall;
}): Promise<{ consumeTurn: boolean; content: string }> => {
    if (request.toolCall.name !== 'search_corpus') {
        return {
            consumeTurn: false,
            content: `Tool error: unsupported tool "${request.toolCall.name}". Use search_corpus for local retrieval.`,
        };
    }
    if (request.remainingTurns <= 0) {
        return {
            consumeTurn: false,
            content: 'No more retrieval turns are available for this answer. Produce the final response from the evidence already provided.',
        };
    }

    const parsedArgs = readSearchCorpusArgs(request.toolCall.arguments, request.maxEvidenceResults);
    if (!parsedArgs.ok) {
        return {
            consumeTurn: false,
            content: `Tool error: ${parsedArgs.message}`,
        };
    }

    const results = await request.retrieval.search({
        limit: parsedArgs.value.limit,
        query: parsedArgs.value.query,
        ...(parsedArgs.value.sourceKeys ? {sourceKeys: parsedArgs.value.sourceKeys} : {}),
        ...(parsedArgs.value.sourceTypes ? {sourceTypes: parsedArgs.value.sourceTypes} : {}),
        timing: request.timing,
    });

    return {
        consumeTurn: true,
        content: [
            `Search progress: ${parsedArgs.value.userMessage}`,
            '',
            'Retrieved evidence:',
            formatEvidence(results),
        ].join('\n'),
    };
};

const readSearchCorpusArgs = (
    rawArguments: string,
    maxEvidenceResults: number,
): {ok: true; value: SearchCorpusToolArgs} | {message: string; ok: false} => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawArguments) as unknown;
    } catch {
        return {
            message: 'tool arguments must be valid JSON.',
            ok: false,
        };
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return {
            message: 'tool arguments must be a JSON object.',
            ok: false,
        };
    }

    const record = parsed as Record<string, unknown>;
    const query = typeof record.query === 'string' ? record.query.trim() : '';
    const userMessage = typeof record.userMessage === 'string' ? record.userMessage.trim() : '';
    if (query.length === 0) {
        return {
            message: 'query is required.',
            ok: false,
        };
    }
    if (userMessage.length === 0) {
        return {
            message: 'userMessage is required.',
            ok: false,
        };
    }

    const sourceTypes = readSourceTypes(record.sourceTypes);
    if (!sourceTypes.ok) {
        return sourceTypes;
    }
    const sourceKeys = readStringArray(record.sourceKeys, 'sourceKeys');
    if (!sourceKeys.ok) {
        return sourceKeys;
    }

    return {
        ok: true,
        value: {
            limit: clampEvidenceLimit(record.limit, maxEvidenceResults),
            query,
            ...(sourceKeys.value ? {sourceKeys: sourceKeys.value} : {}),
            ...(sourceTypes.value ? {sourceTypes: sourceTypes.value} : {}),
            userMessage,
        },
    };
};

const readSourceTypes = (value: unknown): {ok: true; value?: SourceType[]} | {message: string; ok: false} => {
    const sourceTypes = readStringArray(value, 'sourceTypes');
    if (!sourceTypes.ok) {
        return sourceTypes;
    }
    if (!sourceTypes.value) {
        return {ok: true};
    }
    if (sourceTypes.value.some(sourceType => !isSourceType(sourceType))) {
        return {
            message: 'sourceTypes must contain only foundry, pdf, or article.',
            ok: false,
        };
    }

    return {
        ok: true,
        value: sourceTypes.value as SourceType[],
    };
};

const readStringArray = (
    value: unknown,
    field: string,
): {ok: true; value?: string[]} | {message: string; ok: false} => {
    if (value === undefined) {
        return {ok: true};
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        return {
            message: `${field} must be an array of strings.`,
            ok: false,
        };
    }
    const normalized = (value as string[]).map(item => item.trim()).filter(item => item.length > 0);
    return {
        ok: true,
        ...(normalized.length > 0 ? {value: normalized} : {}),
    };
};

const clampEvidenceLimit = (value: unknown, maxEvidenceResults: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return maxEvidenceResults;
    }

    return Math.min(maxEvidenceResults, Math.max(1, Math.trunc(value)));
};

const formatEvidence = (results: RetrievalResult[]): string => {
    if (results.length === 0) {
        return 'No relevant retrieval results were found. Say when the answer is not supported by the local corpus.';
    }

    return results
        .map((result, index) => [
            `[${index + 1}] ${formatCitation(result)}`,
            `Match: ${result.matchKind}, score=${result.score.toFixed(3)}`,
            result.content,
        ].join('\n'))
        .join('\n\n');
};

const formatCitation = (result: RetrievalResult): string => {
    const locator = result.citation.locator ? `, ${result.citation.locator}` : '';
    const url = result.citation.url ? `, ${result.citation.url}` : '';
    return `${result.citation.label}${locator}${url} [${result.sourceType}:${result.sourceKey}]`;
};
