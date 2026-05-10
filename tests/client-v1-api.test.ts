// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  askAssistant,
  generateNpcs,
  getContext,
  getLog,
  getNpcs,
  getStatus,
  refresh,
  subscribeConsole,
  writeContext
} from "../src/client/v1/api.js";

describe("v1 client API paths", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("targets /api/v1 routes for JSON endpoints", async () => {
    await getLog({ sessionId: "session-1" });
    await getContext();
    await getNpcs();
    await getStatus({ sessionId: "session-2" });
    await writeContext("notes");
    await askAssistant("prompt", "session-3", true, 2);
    await generateNpcs("npc prompt", "session-4", false, 3);
    await refresh(true);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/v1/log?sessionId=session-1",
      "/api/v1/context",
      "/api/v1/npcs",
      "/api/v1/status?sessionId=session-2",
      "/api/v1/context",
      "/api/v1/assistant",
      "/api/v1/npcs",
      "/api/v1/refresh"
    ]);
  });

  it("targets /api/v1/console/events for console subscriptions", () => {
    const close = vi.fn();
    const eventSource = {
      close,
      onmessage: null as ((event: MessageEvent<string>) => void) | null
    };
    const eventSourceConstructor = vi.fn(() => eventSource);
    vi.stubGlobal("EventSource", eventSourceConstructor);

    const unsubscribe = subscribeConsole(() => undefined);

    expect(eventSourceConstructor).toHaveBeenCalledWith("/api/v1/console/events");
    unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
