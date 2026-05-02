import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createWebApp, isBusyError } from "../src/server/app.js";
import type { AssistantSessionAnswer } from "../src/runtime/assistant-session.js";
import { createDefaultRuntimeState } from "../src/state/state-store.js";
import type { RuntimeConfig, RetrievalResult } from "../src/types.js";

const TEST_ROOT = path.resolve(".test-tmp", "server-app");

afterEach(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
});

describe("web app API model", () => {
  it("does not create a session log until output is written", async () => {
    const config = await writeConfig("lazy-log");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    await expect(readdir(config.logDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(app.getLog()).resolves.toEqual({ filePath: null, markdown: "" });
  });

  it("reads and writes additional context", async () => {
    const config = await writeConfig("context");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    expect(await app.getContext()).toBe("");
    await app.writeContext("Campaign context");

    expect(await readFile(config.assistant.additionalContextPath, "utf8")).toBe("Campaign context");
    expect(await app.getContext()).toBe("Campaign context");
  });

  it("logs assistant exchanges through the active log", async () => {
    const app = createWebApp({
      config: await writeConfig("assistant"),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue("<session-title>Aerenal</session-title>\n<answer>\nAerenal answer.\n</answer>")
      }
    });

    const response = await app.askAssistant("What about Aerenal?");

    expect(response.log.markdown).toContain("## User\n\nWhat about Aerenal?");
    expect(response.log.markdown).toContain("## Assistant\n\nAerenal answer.");
    expect(response.log.markdown).not.toContain("<session-title>");
  });

  it("logs debug retrieval results", async () => {
    const app = createWebApp({
      config: await writeConfig("debug"),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const response = await app.debugRetrieval("aerenal deathless");

    expect(response.log.markdown).toContain("## Debug Retrieval");
    expect(response.log.markdown).toContain("Query: aerenal deathless");
    expect(response.log.markdown).toContain("[hybrid 0.900] pdf:Eberron Rising page 4");
  });

  it("runs refresh and force reingest with the requested runtime option", async () => {
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    const inspectSources = vi.fn().mockResolvedValue({
      degraded: false,
      nextState,
      inventories: []
    });
    const ingest = vi.fn().mockResolvedValue({
      nextState,
      summary: {
        corpusSourceCount: 1,
        degraded: false,
        sourceSummaries: []
      }
    });
    const refresh = vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 0, regeneratedEmbeddings: 1 });
    const app = createWebApp({
      config: await writeConfig("refresh"),
      discovery: { inspectSources },
      ingestion: { ingest },
      retrieval: {
        refresh,
        search: vi.fn().mockResolvedValue([])
      },
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      },
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    await app.refresh(false);
    await app.refresh(true);

    expect(inspectSources.mock.calls[0]?.[1]).toMatchObject({ forceReingest: false });
    expect(inspectSources.mock.calls[1]?.[1]).toMatchObject({ forceReingest: true });
    expect(refresh.mock.calls[0]?.[1]).toEqual({ forceRebuild: false });
    expect(refresh.mock.calls[1]?.[1]).toEqual({ forceRebuild: true });
  });

  it("rejects overlapping operations with a busy error", async () => {
    let resolveAsk: (() => void) | undefined;
    const app = createWebApp({
      config: await writeConfig("busy"),
      assistant: {
        ask: vi.fn(
          () =>
            new Promise<AssistantSessionAnswer>((resolve) => {
              resolveAsk = () => resolve({ answer: "answer", evidence: [] });
            })
        )
      },
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const pending = app.askAssistant("Slow question");
    await expect(app.debugRetrieval("blocked")).rejects.toSatisfy(isBusyError);
    if (!resolveAsk) {
      throw new Error("Assistant promise was not started.");
    }
    resolveAsk();
    await pending;
  });
});

const writeConfig = async (name: string): Promise<RuntimeConfig> => {
  const config = loadDefaultConfig(path.join(TEST_ROOT, name));
  await mkdir(config.assistant.assistantDir, { recursive: true });
  await writeFile(config.assistant.systemPromptPath, "System prompt.", "utf8");
  await writeFile(config.assistant.sessionTitlePromptPath, "<session-title>Title</session-title><answer>Answer</answer>", "utf8");
  return config;
};

const mockRetrieval = (
  results: RetrievalResult[]
): { retrieval: { refresh: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> } } => ({
  retrieval: {
    refresh: vi.fn().mockResolvedValue({ chunkCount: results.length, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
    search: vi.fn().mockResolvedValue(results)
  }
});

const result = (): RetrievalResult => ({
  chunkId: "pdf:eberron.pdf:0",
  sourceId: "pdf:eberron.pdf",
  sourceType: "pdf",
  sourceKey: "eberron.pdf",
  sourceTitle: "Eberron Rising",
  content: "Aerenal keeps deathless counselors.",
  citation: {
    sourceType: "pdf",
    label: "Eberron Rising",
    locator: "page 4",
    url: null
  },
  score: 0.9,
  matchKind: "hybrid"
});
