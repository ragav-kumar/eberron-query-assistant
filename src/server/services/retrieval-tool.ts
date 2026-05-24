import { SourceType } from '@/types.js';

import {
    ChatAdapter,
    ChatCompletionOptions,
    ChatMessage,
    ChatStructuredResult,
    ChatToolDefinition,
} from './provider.js';

/**
 * HASTILY COPIED FROM V1 TO PURGE A FORBIDDEN V2 -> V1 REFERENCE.
 *
 * Treat this module as a priority refactor target. It exists only to keep V2
 * self-contained after removing the cross-version import, and its API/shape
 * should be revisited rather than extended casually.
 */
const SEARCH_CORPUS_TOOL_NAME = 'search_corpus';

export const buildRetrievalTool = (maxEvidenceResults: number): ChatToolDefinition => ({
    description: 'Search the local Eberron corpus for targeted supporting evidence.',
    name: SEARCH_CORPUS_TOOL_NAME,
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
            },
            sourceTypes: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['foundry', 'pdf', 'article'],
                },
            },
            sourceKeys: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
            limit: {
                type: 'integer',
                minimum: 1,
                maximum: maxEvidenceResults,
            },
            userMessage: {
                type: 'string',
            },
        },
        required: ['query', 'userMessage'],
    },
});

export const clampRetrievalTurnLimit = (value: number, maxRetrievalToolTurns: number): number => {
    if (!Number.isFinite(value)) {
        return 1;
    }

    return Math.min(maxRetrievalToolTurns, Math.max(0, Math.trunc(value)));
};

export const buildRetrievalToolInstructions = (retrievalTurnLimit: number): string => retrievalTurnLimit > 0
    ? [
        `You may call the ${SEARCH_CORPUS_TOOL_NAME} tool when the initial evidence is not enough.`,
        'Use it only for targeted follow-up retrieval.',
        `You may make at most ${retrievalTurnLimit} additional retrieval request${retrievalTurnLimit === 1 ? '' : 's'}.`,
        'Set userMessage to concise progress text suitable for user-visible progress output. Do not include hidden reasoning.',
    ].join('\n')
    : 'No additional retrieval tool calls are available for this response. Answer from the initial evidence only.';

export const completeStructured = async (
    chat: ChatAdapter,
    messages: ChatMessage[],
    options: ChatCompletionOptions,
): Promise<ChatStructuredResult> => {
    if (chat.completeStructured) {
        return chat.completeStructured(messages, options);
    }

    return {
        content: await chat.complete(messages, options),
        kind: 'text',
    };
};

export const isSourceType = (value: string): value is SourceType => value === 'foundry' || value === 'pdf' || value === 'article';
