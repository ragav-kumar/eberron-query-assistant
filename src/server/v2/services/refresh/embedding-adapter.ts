import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';
import type { EmbeddingAdapter } from '@/server/v2/db/corpus/index.js';

import type { RefreshProviderSettings } from './types.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_MAX_RETRIES = 3;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 500;

export interface OpenAiProviderOptions {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    requestTimeoutMs?: number;
    retryDelayMs?: number;
}

export const createOpenAiEmbeddingAdapter = (
    config: RefreshProviderSettings,
    options: OpenAiProviderOptions = {},
): EmbeddingAdapter => {
    if (!config.apiKey) {
        throw createTaggedError('provider-api-key-missing', 'OPENAI_API_KEY is required for provider-backed embeddings.');
    }

    let failedRetries = 0;

    const embedBatch = async (inputs: string[]): Promise<number[][]> => {
        if (inputs.length === 0) {
            return [];
        }

        const response = await fetchWithRetry(
            `${config.baseUrl}/embeddings`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    encoding_format: 'float',
                    input: inputs,
                    model: config.embeddingModel,
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
        embed: async input => {
            const [embedding] = await embedBatch([input]);
            if (!embedding) {
                throw createTaggedError('provider-embedding-empty', 'Embedding response did not include a numeric vector.');
            }
            return embedding;
        },
        embedBatch,
    };
};

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

const readEmbeddings = (body: unknown): number[][] => {
    if (!isRecord(body) || !Array.isArray(body.data)) {
        return [];
    }

    return body.data
        .map((item, fallbackIndex) => {
            if (!isRecord(item) || !Array.isArray(item.embedding)) {
                return null;
            }

            if (!item.embedding.every(value => typeof value === 'number')) {
                return null;
            }

            return {
                embedding: item.embedding,
                index: typeof item.index === 'number' ? item.index : fallbackIndex,
            };
        })
        .filter((item): item is { embedding: number[]; index: number } => item !== null)
        .sort((left, right) => left.index - right.index)
        .map(item => item.embedding);
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
    await new Promise<void>(resolve => {
        setTimeout(resolve, durationMs);
    });
};
