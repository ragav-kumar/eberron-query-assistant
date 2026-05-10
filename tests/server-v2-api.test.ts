import { describe, expect, it } from "vitest";

import { handleV2ApiRequest } from "../src/server/v2/api.js";

describe("v2 API handler", () => {
  const concretePaths: Array<[string, string]> = [
    ["GET", "/api/v2/additional-context"],
    ["PUT", "/api/v2/additional-context"],
    ["GET", "/api/v2/sessions"],
    ["POST", "/api/v2/sessions"],
    ["GET", "/api/v2/sessions/session-1"],
    ["GET", "/api/v2/sessions/session-1/entries"],
    ["POST", "/api/v2/sessions/session-1/runs"],
    ["GET", "/api/v2/runs/run-1"],
    ["GET", "/api/v2/npcs"],
    ["POST", "/api/v2/refresh"],
    ["GET", "/api/v2/refresh/refresh-1"],
    ["GET", "/api/v2/console"],
    ["GET", "/api/v2/console/events"],
    ["GET", "/api/v2/runtime/events"],
  ];

  for (const [method, path] of concretePaths) {
    it(`returns not implemented for ${method} ${path}`, () => {
      const request = createRequest(method, path);
      const response = createResponse();

      handleV2ApiRequest(request as never, response as never);

      expect(response.statusCode).toBe(501);
      expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
      expect(response.body).toBe(JSON.stringify({ error: "API v2 is not implemented." }));
    });
  }

  it("returns 404 for unknown v2 routes", () => {
    const request = createRequest("GET", "/api/v2/unknown");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(JSON.stringify({ error: "Unknown API route." }));
  });
});

const createRequest = (method: string, url: string) => ({
  method,
  on() {
    return undefined;
  },
  url
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
    }
  };
};
