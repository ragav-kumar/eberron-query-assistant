import { describe, expect, it, vi } from 'vitest';

import {
    createOpenAiChatAdapter,
    createOpenAiEmbeddingAdapter,
} from '@server/services/provider/index.js';

describe('V2 provider transport', () => {
    it('retries retryable embedding failures and preserves vector ordering', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 429 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                data: [
                    { embedding: [2, 2], index: 1 },
                    { embedding: [1, 1], index: 0 },
                ],
            }), { status: 200 })) as unknown as typeof fetch;
        const adapter = createOpenAiEmbeddingAdapter({
            apiKey: 'key',
            baseUrl: 'https://api.example.com/v1',
            embeddingModel: 'embed-model',
        }, {
            fetchImpl,
            retryDelayMs: 0,
        });

        const embeddings = await adapter.embedBatch(['first', 'second']);

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(adapter.failedRetries).toBe(1);
        expect(embeddings).toEqual([[1, 1], [2, 2]]);
    });

    it('times out provider requests through the shared transport layer', async () => {
        const fetchImpl = vi.fn((_: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as unknown as typeof fetch;
        const adapter = createOpenAiEmbeddingAdapter({
            apiKey: 'key',
            baseUrl: 'https://api.example.com/v1',
            embeddingModel: 'embed-model',
        }, {
            fetchImpl,
            maxRetries: 0,
            requestTimeoutMs: 1,
        });

        await expect(adapter.embed('hello')).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('distinguishes text and tool-call chat responses', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: '<thinking>Need a search.</thinking>',
                        tool_calls: [{
                            id: 'tool-1',
                            function: {
                                arguments: '{"query":"foo","userMessage":"Searching"}',
                                name: 'search_corpus',
                            },
                        }],
                    },
                }],
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: 'Plain answer',
                    },
                }],
            }), { status: 200 })) as unknown as typeof fetch;
        const chat = createOpenAiChatAdapter({
            apiKey: 'key',
            baseUrl: 'https://api.example.com/v1',
            chatModel: 'chat-model',
            embeddingModel: 'embed-model',
        }, {
            fetchImpl,
        });

        const structured = await chat.completeStructured?.([{ content: 'Question', role: 'user' }], {
            tools: [{
                description: 'Search',
                name: 'search_corpus',
                parameters: { type: 'object' },
            }],
        });
        const text = await chat.complete([{ content: 'Question', role: 'user' }]);

        expect(structured).toMatchObject({
            kind: 'tool-calls',
            toolCalls: [{ id: 'tool-1', name: 'search_corpus' }],
        });
        expect(text).toBe('Plain answer');
    });

});
