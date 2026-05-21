import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';

/**
 * HASTILY COPIED FROM V1 TO PURGE A FORBIDDEN V2 -> V1 REFERENCE.
 *
 * Treat this module as a priority refactor target. It is intentionally local to
 * V2 so V2 no longer depends on V1, but the current contents were duplicated
 * with minimal redesign and should not be treated as the intended long-term
 * V2 provider boundary.
 */
const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_MAX_RETRIES = 3;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 500;

export interface ProviderConfig {
    apiKey: string;
    baseUrl: string;
    chatModel: string;
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

export interface OpenAiProviderOptions {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    requestTimeoutMs?: number;
    retryDelayMs?: number;
}

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
    config: ProviderConfig,
    options: OpenAiProviderOptions = {},
): EmbeddingAdapter => {
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

const createOpenAiRequestConfig = (config: ProviderConfig): { baseUrl: string; headers: Record<string, string> } => ({
    baseUrl: config.baseUrl,
    headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
    },
});

const readJsonResponse = async (response: Response): Promise<unknown> => {
    const text = await response.text();
    if (text.length === 0) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw createTaggedError('provider-invalid-json', `Provider returned invalid JSON: ${formatThrownValue(error)}`);
    }
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

const readEmbeddings = (body: unknown): number[][] => {
    if (!isRecord(body) || !Array.isArray(body.data)) {
        return [];
    }

    return body.data
        .map((item, fallbackIndex) => {
            if (!isRecord(item) || !Array.isArray(item.embedding)) {
                return null;
            }

            const embedding = item.embedding;
            if (!embedding.every((value) => typeof value === 'number')) {
                return null;
            }

            return {
                index: typeof item.index === 'number' ? item.index : fallbackIndex,
                embedding,
            };
        })
        .filter((item): item is { index: number; embedding: number[] } => item !== null)
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
};

const formatProviderError = (fallback: string, body: unknown): string => {
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
        return `${fallback}: ${body.error.message}`;
    }

    return fallback;
};

const fetchWithRetry = async (
    url: string,
    init: RequestInit,
    options: OpenAiProviderOptions & { onRetry?: () => void },
): Promise<Response> => {
    const maxRetries = options.maxRetries ?? DEFAULT_PROVIDER_MAX_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_PROVIDER_RETRY_DELAY_MS;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, init, options);
            if (!isRetryableStatus(response.status) || attempt === maxRetries) {
                return response;
            }
            lastError = createTaggedError('provider-retryable-status', `Provider returned retryable status ${response.status}.`);
        } catch (error) {
            if (!isRetryableFetchError(error) || attempt === maxRetries) {
                throw error;
            }
            lastError = error;
        }

        options.onRetry?.();
        await delay(retryDelayMs * 2 ** attempt);
    }

    throw lastError ?? createTaggedError('provider-request-failed', 'Provider request failed.');
};

const fetchWithTimeout = async (
    url: string,
    init: RequestInit,
    options: OpenAiProviderOptions,
): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);

    try {
        return await (options.fetchImpl ?? fetch)(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
};

const isRetryableStatus = (status: number): boolean => status === 408 || status === 409 || status === 429 || status >= 500;

const isRetryableFetchError = (error: unknown): boolean => {
    if (!isRecord(error)) {
        return false;
    }

    return error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError';
};

const delay = async (durationMs: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
    });
};
