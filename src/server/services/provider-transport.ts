import { createTaggedError, formatThrownValue, isRecord } from '@/errors.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_MAX_RETRIES = 3;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 500;

export interface OpenAiProviderTransportOptions {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    requestTimeoutMs?: number;
    retryDelayMs?: number;
}

export interface OpenAiProviderRequestConfig {
    apiKey: string;
    baseUrl: string;
}

export const createOpenAiRequestConfig = (
    config: OpenAiProviderRequestConfig,
): { baseUrl: string; headers: Record<string, string> } => ({
    baseUrl: config.baseUrl,
    headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
    },
});

export const readJsonResponse = async (response: Response): Promise<unknown> => {
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

export const formatProviderError = (fallback: string, body: unknown): string => {
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
        return `${fallback}: ${body.error.message}`;
    }

    return fallback;
};

export const readEmbeddings = (body: unknown): number[][] => {
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

export const fetchWithRetry = async (
    url: string,
    init: RequestInit,
    options: OpenAiProviderTransportOptions & { onRetry?: () => void } = {},
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
    options: OpenAiProviderTransportOptions,
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
