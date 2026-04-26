import { createTaggedError, formatThrownValue, isRecord } from "../errors.js";
import type { ProviderConfig } from "../types.js";

const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_MAX_RETRIES = 3;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 500;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatAdapter {
  complete(messages: ChatMessage[]): Promise<string>;
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
  options: OpenAiProviderOptions = {}
): ChatAdapter => {
  const provider = createOpenAiRequestConfig(config);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(messages) {
      const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: provider.headers,
        body: JSON.stringify({
          model: config.chatModel,
          messages
        })
      });

      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw createTaggedError("provider-chat-failed", formatProviderError("Chat completion failed", body));
      }

      const content = readChatCompletionContent(body);
      if (!content) {
        throw createTaggedError("provider-chat-empty", "Chat completion response did not include assistant content.");
      }

      return content;
    }
  };
};

export const createOpenAiEmbeddingAdapter = (
  config: ProviderConfig,
  options: OpenAiProviderOptions = {}
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
        method: "POST",
        headers: provider.headers,
        body: JSON.stringify({
          model: config.embeddingModel,
          input: inputs,
          encoding_format: "float"
        })
      },
      {
        ...options,
        onRetry: () => {
          failedRetries += 1;
        }
      }
    );

    const body = await readJsonResponse(response);
    if (!response.ok) {
      throw createTaggedError("provider-embedding-failed", formatProviderError("Embedding request failed", body));
    }

    const embeddings = readEmbeddings(body);
    if (embeddings.length !== inputs.length) {
      throw createTaggedError("provider-embedding-empty", "Embedding response did not include every requested vector.");
    }

    return embeddings;
  };

  return {
    get failedRetries() {
      return failedRetries;
    },
    modelId: config.embeddingModel,
    schemaVersion: `openai-compatible:${config.embeddingModel}`,
    async embed(input) {
      const [embedding] = await embedBatch([input]);
      if (!embedding) {
        throw createTaggedError("provider-embedding-empty", "Embedding response did not include a numeric vector.");
      }
      return embedding;
    },
    embedBatch
  };
};

export const createDeterministicEmbeddingAdapter = (): EmbeddingAdapter => {
  const embed = (input: string): Promise<number[]> => {
    const vector = Array.from({ length: 8 }, () => 0);
    const words = input.toLowerCase().match(/[a-z0-9]+/g) ?? [];

    for (const word of words) {
      const index = stableWordIndex(word, vector.length);
      vector[index] = (vector[index] ?? 0) + 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return Promise.resolve(magnitude === 0 ? vector : vector.map((value) => value / magnitude));
  };

  return {
    failedRetries: 0,
    modelId: "local-deterministic-v1",
    schemaVersion: "local-vector-8",
    embed,
    embedBatch(inputs) {
      return Promise.all(inputs.map((input) => embed(input)));
    }
  };
};

const stableWordIndex = (word: string, modulo: number): number => {
  let hash = 0;
  for (const character of word) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash % modulo;
};

const createOpenAiRequestConfig = (config: ProviderConfig): { baseUrl: string; headers: Record<string, string> } => {
  if (!config.apiKey) {
    throw createTaggedError("provider-api-key-missing", "OPENAI_API_KEY is required for provider-backed chat.");
  }

  return {
    baseUrl: config.baseUrl,
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    }
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
    throw createTaggedError("provider-invalid-json", `Provider returned invalid JSON: ${formatThrownValue(error)}`);
  }
};

const readChatCompletionContent = (body: unknown): string | null => {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return null;
  }

  const first = body.choices[0] as unknown;
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
    return null;
  }

  const content = first.message.content.trim();
  return content.length > 0 ? content : null;
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

      const embedding = item.embedding;
      if (!embedding.every((value) => typeof value === "number")) {
        return null;
      }

      return {
        index: typeof item.index === "number" ? item.index : fallbackIndex,
        embedding
      };
    })
    .filter((item): item is { index: number; embedding: number[] } => item !== null)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
};

const formatProviderError = (fallback: string, body: unknown): string => {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return `${fallback}: ${body.error.message}`;
  }

  return fallback;
};

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  options: OpenAiProviderOptions & { onRetry?: () => void }
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
      lastError = createTaggedError("provider-retryable-status", `Provider returned retryable status ${response.status}.`);
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt === maxRetries) {
        throw error;
      }
      lastError = error;
    }

    options.onRetry?.();
    await delay(retryDelayMs * 2 ** attempt);
  }

  throw lastError ?? createTaggedError("provider-request-failed", "Provider request failed.");
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  options: OpenAiProviderOptions
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  timeout.unref?.();

  try {
    return await (options.fetchImpl ?? fetch)(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const isRetryableStatus = (status: number): boolean => {
  return status === 408 || status === 409 || status === 429 || status >= 500;
};

const isRetryableFetchError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";
};

const delay = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, durationMs);
    timeout.unref?.();
  });
};
