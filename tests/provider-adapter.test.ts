import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiChatAdapter,
  createOpenAiEmbeddingAdapter,
  type ChatMessage
} from "../src/provider/index.js";
import type { ProviderConfig } from "../src/types.js";

const config: ProviderConfig = {
  apiKey: "sk-test-secret",
  baseUrl: "https://provider.example/v1",
  chatModel: "gpt-test-chat",
  embeddingModel: "text-embedding-test"
};

describe("OpenAI-compatible provider adapters", () => {
  it("sends chat completions without exposing the API key in errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: "Aerenal uses deathless ancestors."
            }
          }
        ]
      })
    );
    const messages: ChatMessage[] = [{ role: "user", content: "What is Aerenal known for?" }];

    await expect(createOpenAiChatAdapter(config, { fetchImpl }).complete(messages)).resolves.toBe(
      "Aerenal uses deathless ancestors."
    );

    const requestUrl = fetchImpl.mock.calls[0]?.[0];
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(requestUrl).toBe("https://provider.example/v1/chat/completions");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({
      Authorization: "Bearer sk-test-secret",
      "Content-Type": "application/json"
    });
    expect(request?.body).toBe(
      JSON.stringify({
        model: "gpt-test-chat",
        messages
      })
    );
  });

  it("returns embedding vectors from the embeddings endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            index: 0,
            embedding: [0.1, 0.2, 0.3]
          }
        ]
      })
    );
    const adapter = createOpenAiEmbeddingAdapter(config, { fetchImpl });

    await expect(adapter.embed("deathless")).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(adapter.modelId).toBe("text-embedding-test");
    expect(adapter.schemaVersion).toBe("openai-compatible:text-embedding-test");
    expect(readRequestBody(fetchImpl)).toMatchObject({
      model: "text-embedding-test",
      input: ["deathless"],
      encoding_format: "float"
    });
  });

  it("sends batched embedding requests and preserves response order", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { index: 1, embedding: [0.2] },
          { index: 0, embedding: [0.1] }
        ]
      })
    );
    const adapter = createOpenAiEmbeddingAdapter(config, { fetchImpl });

    await expect(adapter.embedBatch(["first", "second"])).resolves.toEqual([[0.1], [0.2]]);
    expect(readRequestBody(fetchImpl)).toMatchObject({
      model: "text-embedding-test",
      input: ["first", "second"]
    });
  });

  it("retries transient embedding failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limit" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: [0.4] }] }));
    const adapter = createOpenAiEmbeddingAdapter(config, {
      fetchImpl,
      maxRetries: 1,
      retryDelayMs: 0
    });

    await expect(adapter.embed("retry me")).resolves.toEqual([0.4]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(adapter.failedRetries).toBe(1);
  });

  it("does not retry non-retryable embedding failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: { message: "bad key" } }, 401));
    const adapter = createOpenAiEmbeddingAdapter(config, {
      fetchImpl,
      maxRetries: 3,
      retryDelayMs: 0
    });

    await expect(adapter.embed("auth failure")).rejects.toMatchObject({
      message: "Embedding request failed: bad key"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out stalled embedding requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const adapter = createOpenAiEmbeddingAdapter(config, {
      fetchImpl,
      maxRetries: 0,
      requestTimeoutMs: 1
    });

    await expect(adapter.embed("timeout")).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requires an API key before making provider requests", () => {
    const fetchImpl = vi.fn<typeof fetch>();

    try {
      createOpenAiChatAdapter({ ...config, apiKey: null }, { fetchImpl });
      throw new Error("Expected adapter creation to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        message: "OPENAI_API_KEY is required for provider-backed chat."
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("formats provider failures without leaking request secrets", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "model unavailable"
          }
        },
        400
      )
    );

    const failure = createOpenAiChatAdapter(config, { fetchImpl }).complete([]);

    await expect(failure).rejects.toMatchObject({
      message: "Chat completion failed: model unavailable"
    });
    await failure.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain("sk-test-secret");
    });
  });
});

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

const readRequestBody = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): unknown => {
  const body = fetchImpl.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string.");
  }

  return JSON.parse(body) as unknown;
};
