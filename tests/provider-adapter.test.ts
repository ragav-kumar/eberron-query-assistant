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
  debug: false,
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

  it("captures successful chat diagnostics only when provider debug is enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: "Debug answer."
            }
          }
        ]
      })
    );
    const onDiagnostic = vi.fn();
    const messages: ChatMessage[] = [{ role: "user", content: "Debug this." }];

    await expect(createOpenAiChatAdapter({ ...config, debug: true }, { fetchImpl }).complete(messages, {
      debug: {
        operation: "assistant",
        operationId: "operation-1",
        purpose: "assistant"
      },
      onDiagnostic
    })).resolves.toBe("Debug answer.");

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      assistantContent: "Debug answer.",
      endpoint: "https://provider.example/v1/chat/completions",
      ok: true,
      operation: "assistant",
      operationId: "operation-1",
      purpose: "assistant",
      requestBody: {
        model: "gpt-test-chat",
        messages
      },
      status: 200
    }));
    expect(JSON.stringify(onDiagnostic.mock.calls[0]?.[0])).not.toContain("sk-test-secret");
  });

  it("does not capture chat diagnostics when provider debug is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: "Debug answer."
            }
          }
        ]
      })
    );
    const onDiagnostic = vi.fn();

    await createOpenAiChatAdapter(config, { fetchImpl }).complete([{ role: "user", content: "Debug this." }], {
      debug: {
        operation: "assistant",
        operationId: "operation-1",
        purpose: "assistant"
      },
      onDiagnostic
    });

    expect(onDiagnostic).not.toHaveBeenCalled();
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

  it("keeps provider retry timers ref'd so top-level runtime awaits can settle", async () => {
    const timeoutHandles: Array<{ unref?: ReturnType<typeof vi.fn> }> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler: () => void, timeout?: number) => {
      const handle = originalSetTimeout(handler, timeout) as ReturnType<typeof originalSetTimeout> & {
        unref?: ReturnType<typeof vi.fn>;
      };
      handle.unref = vi.fn();
      timeoutHandles.push(handle);
      return handle;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limit" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ data: [{ index: 0, embedding: [0.4] }] }));

    try {
      const adapter = createOpenAiEmbeddingAdapter(config, {
        fetchImpl,
        maxRetries: 1,
        retryDelayMs: 1
      });

      await expect(adapter.embed("retry me")).resolves.toEqual([0.4]);
      expect(timeoutHandles.length).toBeGreaterThan(0);
      expect(timeoutHandles.every((handle) => handle.unref && handle.unref.mock.calls.length === 0)).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
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

  it("captures failed chat diagnostics without leaking request secrets", async () => {
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
    const onDiagnostic = vi.fn();

    await expect(createOpenAiChatAdapter({ ...config, debug: true }, { fetchImpl }).complete([], {
      debug: {
        operation: "assistant",
        operationId: "operation-2",
        purpose: "assistant"
      },
      onDiagnostic
    })).rejects.toMatchObject({
      message: "Chat completion failed: model unavailable"
    });

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      error: "Chat completion failed: model unavailable",
      ok: false,
      responseBody: {
        error: {
          message: "model unavailable"
        }
      },
      status: 400
    }));
    expect(JSON.stringify(onDiagnostic.mock.calls[0]?.[0])).not.toContain("sk-test-secret");
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
