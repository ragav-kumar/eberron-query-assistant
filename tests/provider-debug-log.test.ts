import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProviderDebugLog, getProviderDebugLogPath } from "../src/server/provider-debug-log.js";

const TEST_ROOT = path.resolve(".test-tmp", "provider-debug-log");

describe("provider debug log", () => {
  afterEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("writes diagnostics as JSON lines", async () => {
    await mkdir(TEST_ROOT, { recursive: true });
    const log = createProviderDebugLog(TEST_ROOT);

    log.append(entry("operation-1", "First answer."));
    await log.flush();

    const file = await readFile(getProviderDebugLogPath(TEST_ROOT), "utf8");
    const lines = file.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      assistantContent: "First answer.",
      kind: "provider-diagnostic",
      operationId: "operation-1"
    });
  });

  it("keeps only the newest lines when the line cap is exceeded", async () => {
    await mkdir(TEST_ROOT, { recursive: true });
    const log = createProviderDebugLog(TEST_ROOT, { maxLines: 2 });

    log.append(entry("operation-1", "First answer."));
    log.append(entry("operation-2", "Second answer."));
    log.append(entry("operation-3", "Third answer."));
    await log.flush();

    const file = await readFile(getProviderDebugLogPath(TEST_ROOT), "utf8");
    const lines = file.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.operationId).toBe("operation-2");
    expect(lines[1]?.operationId).toBe("operation-3");
  });
});

const entry = (operationId: string, assistantContent: string): Record<string, unknown> => ({
  assistantContent,
  endpoint: "https://provider.example/v1/chat/completions",
  kind: "provider-diagnostic",
  ok: true,
  operation: "assistant",
  operationId,
  purpose: "assistant",
  requestBody: {
    messages: [{ role: "user", content: "Question" }],
    model: "gpt-test-chat"
  },
  responseBody: {
    choices: [{ message: { content: assistantContent } }]
  },
  status: 200,
  timestamp: new Date().toISOString()
});
