import { describe, expect, it } from "vitest";

import { v2Contracts } from "../src/contracts.v2.js";
import { handleV2ApiRequest } from "../src/server/v2/api.js";

describe("v2 API handler", () => {
  for (const endpoint of Object.values(v2Contracts)) {
    it(`returns not implemented for ${endpoint.path}`, () => {
      const request = createRequest(endpoint.method, endpoint.path);
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
