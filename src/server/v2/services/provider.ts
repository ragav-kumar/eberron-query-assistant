import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';
import {
    createOpenAiRequestConfig,
    fetchWithRetry,
    formatProviderError,
    OpenAiProviderTransportOptions,
    readEmbeddings,
    readJsonResponse,
} from './provider-transport.js';

/**
 * HASTILY COPIED FROM V1 TO PURGE A FORBIDDEN V2 -> V1 REFERENCE.
 *
 * Treat this module as a priority refactor target. It is intentionally local to
 * V2 so V2 no longer depends on V1, but the current contents were duplicated
 * with minimal redesign and should not be treated as the intended long-term
 * V2 provider boundary.
 */
export interface ProviderConfig {
    apiKey: string;
    baseUrl: string;
    chatModel: string;
    embeddingModel: string;
}

export interface OpenAiEmbeddingConfig {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ChatToolCall[];
}

export interface ChatToolDefinition {
    description: string;
    name: string;
    parameters: Record<string, unknown>;
}

export interface ChatToolCall {
    arguments: string;
    id: string;
    name: string;
}

export interface ChatStructuredTextResult {
    content: string;
    kind: 'text';
}

export interface ChatStructuredToolCallResult {
    content: string;
    kind: 'tool-calls';
    toolCalls: ChatToolCall[];
}

export type ChatStructuredResult = ChatStructuredTextResult | ChatStructuredToolCallResult;

export interface ChatCompletionDebugContext {
    operation: string;
    operationId: string;
    purpose: string;
}

export interface ChatCompletionDiagnostic {
    assistantContent?: string;
    endpoint: string;
    error?: string;
    ok: boolean;
    operation: string;
    operationId: string;
    purpose: string;
    requestBody: {
        messages: unknown[];
        model: string;
        tools?: unknown[];
    };
    responseBody?: unknown;
    status?: number;
    timestamp: string;
}

export interface ChatCompletionOptions {
    debug?: ChatCompletionDebugContext;
    onDiagnostic?: ((diagnostic: ChatCompletionDiagnostic) => void) | undefined;
    tools?: ChatToolDefinition[] | undefined;
}

export interface ChatAdapter {
    complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
    completeStructured?(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatStructuredResult>;
}

export interface EmbeddingAdapter {
    readonly failedRetries?: number;
    modelId: string;
    schemaVersion: string;
    embed(input: string): Promise<number[]>;
    embedBatch(inputs: string[]): Promise<number[][]>;
}

export type OpenAiProviderOptions = OpenAiProviderTransportOptions;

export const createOpenAiChatAdapter = (
    config: ProviderConfig,
    options: OpenAiProviderOptions = {},
): ChatAdapter => {
    const provider = createOpenAiRequestConfig(config);

    const completeStructured = async (
        messages: ChatMessage[],
        completionOptions: ChatCompletionOptions = {},
    ): Promise<ChatStructuredResult> => {
        const endpoint = `${provider.baseUrl}/chat/completions`;
        const requestBody = {
            model: config.chatModel,
            messages: messages.map(serializeChatMessage),
            ...(completionOptions.tools && completionOptions.tools.length > 0
                ? { tools: completionOptions.tools.map(serializeToolDefinition) }
                : {}),
        };
        const emitDiagnostic = (
            diagnostic: Omit<ChatCompletionDiagnostic, 'endpoint' | 'operation' | 'operationId' | 'purpose' | 'requestBody' | 'timestamp'>,
        ): void => {
            if (!completionOptions.debug || !completionOptions.onDiagnostic) {
                return;
            }

            completionOptions.onDiagnostic({
                ...completionOptions.debug,
                ...diagnostic,
                endpoint,
                requestBody,
                timestamp: new Date().toISOString(),
            });
        };

        let response: Response;
        try {
            response = await fetchWithRetry(
                endpoint,
                {
                    method: 'POST',
                    headers: provider.headers,
                    body: JSON.stringify(requestBody),
                },
                options,
            );
        } catch (error) {
            emitDiagnostic({
                error: formatThrownValue(error),
                ok: false,
            });
            throw error;
        }

        const body = await readJsonResponse(response);
        if (!response.ok) {
            const message = formatProviderError('Chat completion failed', body);
            emitDiagnostic({
                error: message,
                ok: false,
                responseBody: body,
                status: response.status,
            });
            throw createTaggedError('provider-chat-failed', message);
        }

        const result = readChatCompletionResult(body);
        if (!result) {
            emitDiagnostic({
                error: 'Chat completion response did not include assistant content.',
                ok: false,
                responseBody: body,
                status: response.status,
            });
            throw createTaggedError('provider-chat-empty', 'Chat completion response did not include assistant content.');
        }

        emitDiagnostic({
            ...(result.kind === 'text' ? { assistantContent: result.content } : {}),
            ok: true,
            responseBody: body,
            status: response.status,
        });
        return result;
    };

    return {
        complete: async (messages, completionOptions = {}) => {
            const response = await completeStructured(messages, completionOptions);
            if (response.kind !== 'text') {
                throw createTaggedError('provider-chat-tool-calls-unexpected', 'Chat completion returned tool calls unexpectedly.');
            }
            return response.content;
        },
        completeStructured,
    };
};

export const createOpenAiEmbeddingAdapter = (
    config: OpenAiEmbeddingConfig,
    options: OpenAiProviderOptions = {},
): EmbeddingAdapter => {
    if (!config.apiKey) {
        throw createTaggedError('provider-api-key-missing', 'OPENAI_API_KEY is required for provider-backed embeddings.');
    }
    const provider = createOpenAiRequestConfig(config);
    let failedRetries = 0;

    const embedBatch = async (inputs: string[]): Promise<number[][]> => {
        if (inputs.length === 0) {
            return [];
        }

        const response = await fetchWithRetry(
            `${provider.baseUrl}/embeddings`,
            {
                method: 'POST',
                headers: provider.headers,
                body: JSON.stringify({
                    model: config.embeddingModel,
                    input: inputs,
                    encoding_format: 'float',
                }),
            },
            {
                ...options,
                onRetry: () => {
                    failedRetries += 1;
                },
            },
        );

        const body = await readJsonResponse(response);
        if (!response.ok) {
            throw createTaggedError('provider-embedding-failed', formatProviderError('Embedding request failed', body));
        }

        const embeddings = readEmbeddings(body);
        if (embeddings.length !== inputs.length) {
            throw createTaggedError('provider-embedding-empty', 'Embedding response did not include every requested vector.');
        }

        return embeddings;
    };

    return {
        get failedRetries() {
            return failedRetries;
        },
        modelId: config.embeddingModel,
        schemaVersion: `openai-compatible:${config.embeddingModel}`,
        embed: async (input) => {
            const [embedding] = await embedBatch([input]);
            if (!embedding) {
                throw createTaggedError('provider-embedding-empty', 'Embedding response did not include a numeric vector.');
            }
            return embedding;
        },
        embedBatch,
    };
};

const readChatCompletionResult = (body: unknown): ChatStructuredResult | null => {
    if (!isRecord(body) || !Array.isArray(body.choices)) {
        return null;
    }

    const first = body.choices[0] as unknown;
    if (!isRecord(first) || !isRecord(first.message)) {
        return null;
    }

    const content = typeof first.message.content === 'string' ? first.message.content.trim() : '';
    const toolCalls = readToolCalls(first.message.tool_calls);

    if (toolCalls.length > 0) {
        return {
            content,
            kind: 'tool-calls',
            toolCalls,
        };
    }

    return content.length > 0
        ? {
            content,
            kind: 'text',
        }
        : null;
};

const readToolCalls = (value: unknown): ChatToolCall[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((entry) => {
        if (
            !isRecord(entry)
            || typeof entry.id !== 'string'
            || !isRecord(entry.function)
            || typeof entry.function.name !== 'string'
            || typeof entry.function.arguments !== 'string'
        ) {
            return [];
        }

        return [{
            arguments: entry.function.arguments,
            id: entry.id,
            name: entry.function.name,
        }];
    });
};

const serializeChatMessage = (message: ChatMessage): Record<string, unknown> => {
    const serialized: Record<string, unknown> = {
        content: message.content,
        role: message.role,
    };

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        serialized.tool_calls = message.toolCalls.map((toolCall) => ({
            function: {
                arguments: toolCall.arguments,
                name: toolCall.name,
            },
            id: toolCall.id,
            type: 'function',
        }));
    }

    if (message.role === 'tool') {
        serialized.name = message.name;
        serialized.tool_call_id = message.toolCallId;
    }

    return serialized;
};

const serializeToolDefinition = (tool: ChatToolDefinition): Record<string, unknown> => ({
    function: {
        description: tool.description,
        name: tool.name,
        parameters: tool.parameters,
    },
    type: 'function',
});
