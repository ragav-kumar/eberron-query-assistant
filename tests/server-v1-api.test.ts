import { describe, expect, it, vi } from "vitest";

import { handleV1ApiRequest } from "../src/server/v1/api.js";

describe("v1 API handler", () => {
  it("serves the legacy context route under /api/v1/context", async () => {
    const app = {
      getContext: vi.fn().mockResolvedValue("Campaign context")
    };
    const request = createRequest("GET", "/api/v1/context");
    const response = createResponse();

    await handleV1ApiRequest(app as never, request as never, response as never);

    expect(app.getContext).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(response.body).toBe(JSON.stringify({ markdown: "Campaign context" }));
  });

  it("returns 404 for the removed unversioned legacy path", async () => {
    const app = {
      getContext: vi.fn()
    };
    const request = createRequest("GET", "/api/context");
    const response = createResponse();

    await handleV1ApiRequest(app as never, request as never, response as never);

    expect(app.getContext).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(JSON.stringify({ error: "Unknown API route." }));
  });
});

const createRequest = (method: string, url: string, body?: string) => ({
  method,
  on: vi.fn(),
  url,
  async *[Symbol.asyncIterator]() {
    if (body !== undefined) {
      await Promise.resolve();
      yield Buffer.from(body);
    }
  }
});

const createResponse = () => {
  const headers: Record<string, string> = {};
  return {
    body: "",
    headers,
    statusCode: 0,
    end(chunk?: string) {
      this.body = chunk ?? "";
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    write: vi.fn(),
    flushHeaders: vi.fn()
  };
};
