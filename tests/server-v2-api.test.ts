import { describe, expect, it } from "vitest";

import { handleV2ApiRequest } from '@/server/v2/api.js';

describe("v2 API handler", () => {
  it("returns additional context markdown for GET", () => {
    const request = createRequest("GET", "/api/v2/additional-context");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(response.body).toContain("# Campaign Context");
    expect(response.body).toContain("Player-Facing Guidance");
  });

  it("returns inert markdown write response for PUT", () => {
    const request = createRequest("PUT", "/api/v2/additional-context");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(response.body).toContain("# Campaign Context");
  });

  it("returns canned session summaries", () => {
    const request = createRequest("GET", "/api/v2/sessions");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    const body = JSON.parse(response.body) as Array<{ id: string; title: string; lastEntryPreview?: string }>;

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({
      id: "session-dragonshards",
      title: "Dragonshard pricing tiers",
    });
    expect(body[1]?.lastEntryPreview).toContain("professional, spies / heist vibe");
  });

  it("returns a canned created session for POST", () => {
    const request = createRequest("POST", "/api/v2/sessions");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      id: "session-dal-quor",
      activeRunId: "run-dal-quor-1",
    });
  });

  it("returns one canned session resource", () => {
    const request = createRequest("GET", "/api/v2/sessions/session-dal-quor");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      id: "session-dal-quor",
      title: "Dal Quor vault pitch",
      activeRunId: "run-dal-quor-1",
    });
  });

  it("returns ordered session entries mapped from the real log shape", () => {
    const request = createRequest("GET", "/api/v2/sessions/session-dal-quor/entries");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    const body = JSON.parse(response.body) as Array<{ kind: string; title?: string; content: string }>;

    expect(response.statusCode).toBe(200);
    expect(body[0]).toMatchObject({
      kind: "system",
    });
    expect(body[1]).toMatchObject({
      kind: "tool-status",
      content: "Looking for Eberron dragonshard tier and pricing guidance.",
    });
    expect(body.some(entry => entry.kind === "user")).toBe(true);
    expect(body.some(entry => entry.kind === "assistant" && entry.title === "Golden Vault briefing variants")).toBe(true);
  });

  it("returns a canned created run for POST", () => {
    const request = createRequest("POST", "/api/v2/sessions/session-dal-quor/runs");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      id: "run-dal-quor-1",
      sessionId: "session-dal-quor",
      status: "completed",
    });
  });

  it("returns one canned run resource", () => {
    const request = createRequest("GET", "/api/v2/runs/run-dal-quor-1");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      id: "run-dal-quor-1",
      sessionId: "session-dal-quor",
      status: "completed",
    });
  });

  it("returns a trimmed NPC collection from generated state", () => {
    const request = createRequest("GET", "/api/v2/npcs");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    const body = JSON.parse(response.body) as { npcs: Array<{ id: number; name: string }> };

    expect(response.statusCode).toBe(200);
    expect(body.npcs).toHaveLength(4);
    expect(body.npcs.map(npc => npc.name)).toContain("Thrum, Keeper of the Blue Room");
  });

  it("returns a completed refresh snapshot for GET and POST", () => {
    const getRequest = createRequest("GET", "/api/v2/refresh");
    const getResponse = createResponse();

    handleV2ApiRequest(getRequest as never, getResponse as never);

    expect(getResponse.statusCode).toBe(200);
    expect(JSON.parse(getResponse.body)).toMatchObject({
      status: "completed",
      forceReingest: false,
    });

    const postRequest = createRequest("POST", "/api/v2/refresh");
    const postResponse = createResponse();

    handleV2ApiRequest(postRequest as never, postResponse as never);

    expect(postResponse.statusCode).toBe(200);
    expect(JSON.parse(postResponse.body)).toMatchObject({
      status: "completed",
      forceReingest: false,
    });
  });

  it("returns a believable console slice", () => {
    const request = createRequest("GET", "/api/v2/console");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    const body = JSON.parse(response.body) as Array<{ level: string; message: string }>;

    expect(response.statusCode).toBe(200);
    expect(body[0]).toMatchObject({
      level: "info",
    });
    expect(body.some(entry => entry.message.includes("Startup refresh complete."))).toBe(true);
  });

  it("connects console SSE without emitting domain events", () => {
    const request = createRequest("GET", "/api/v2/console/events");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(response.headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(response.headers.Connection).toBe("keep-alive");
    expect(response.body).toBe(": connected\n\n");
  });

  it("connects runtime SSE without emitting domain events", () => {
    const request = createRequest("GET", "/api/v2/runtime/events");
    const response = createResponse();

    handleV2ApiRequest(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(response.body).toBe(": connected\n\n");
  });

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
    flushHeaders() {
      return undefined;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    write(chunk: string) {
      this.body += chunk;
    }
  };
};
