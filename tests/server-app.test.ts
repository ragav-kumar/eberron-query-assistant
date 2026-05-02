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
    await expect(app.getLog()).resolves.toEqual(emptyLogResponse());
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
      ...mockRefreshDependencies(),
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

  it("writes debug retrieval results to console without creating a transcript", async () => {
    const config = await writeConfig("debug");
    const retrievalFixture = mockRetrieval([result()]);
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: retrievalFixture.retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const response = await app.debugRetrieval("aerenal deathless");

    expect(response.log).toEqual(emptyLogResponse());
    expect(response.console.entries.map((entry) => entry.message).join("\n")).toContain(
      "Debug retrieval query: aerenal deathless"
    );
    expect(response.console.entries.map((entry) => entry.message).join("\n")).toContain(
      "[hybrid 0.900] pdf:Eberron Rising page 4"
    );
    expect(retrievalFixture.retrieval.refresh).toHaveBeenCalledWith(config, { forceRebuild: false });
    await expect(readdir(config.logDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs refresh and force reingest with the requested runtime option and console output", async () => {
    const config = await writeConfig("refresh");
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
      config,
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

    const firstResponse = await app.refresh(false);
    const secondResponse = await app.refresh(true);

    expect(inspectSources.mock.calls[0]?.[1]).toMatchObject({ forceReingest: false });
    expect(inspectSources.mock.calls[1]?.[1]).toMatchObject({ forceReingest: true });
    expect(refresh.mock.calls[0]?.[1]).toEqual({ forceRebuild: false });
    expect(refresh.mock.calls[1]?.[1]).toEqual({ forceRebuild: true });
    expect(firstResponse.log).toEqual(emptyLogResponse());
    expect(secondResponse.console.entries.map((entry) => entry.message).join("\n")).toContain("Refresh complete.");
    await expect(readdir(config.logDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lists Markdown logs newest first and reads selected historical logs", async () => {
    const config = await writeConfig("log-browser");
    await mkdir(config.logDir, { recursive: true });
    await writeFile(path.join(config.logDir, "20260101000000 Old.md"), "# Old", "utf8");
    await writeFile(path.join(config.logDir, "20260201000000 New.md"), "# New", "utf8");
    await writeFile(path.join(config.logDir, "notes.txt"), "not a transcript", "utf8");
    await mkdir(path.join(config.logDir, "nested"), { recursive: true });
    await writeFile(path.join(config.logDir, "nested", "20260301000000 Nested.md"), "# Nested", "utf8");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const response = await app.getLog(path.join(config.logDir, "20260101000000 Old.md"));

    expect(response.markdown).toBe("# Old");
    expect(response.readOnly).toBe(true);
    expect(response.files.map((file) => file.label)).toEqual(["20260201000000 New.md", "20260101000000 Old.md"]);
  });

  it("rejects unsafe or missing log selections", async () => {
    const config = await writeConfig("unsafe-log-selection");
    await mkdir(config.logDir, { recursive: true });
    await writeFile(path.join(config.logDir, "20260101000000 Old.md"), "# Old", "utf8");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    await expect(app.getLog(path.join(config.logDir, "nested", "Bad.md"))).rejects.toThrow(
      "Selected log file must be a Markdown file directly inside the log directory."
    );
    await expect(app.getLog(path.join(config.logDir, "..", "Bad.md"))).rejects.toThrow(
      "Selected log file must be a Markdown file directly inside the log directory."
    );
    await expect(app.getLog(path.join(config.logDir, "missing.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps historical log browsing read-only while assistant prompts write to the active session", async () => {
    const config = await writeConfig("historical-readonly");
    await mkdir(config.logDir, { recursive: true });
    const oldPath = path.join(config.logDir, "20260101000000 Old.md");
    await writeFile(oldPath, "# Old\n\nOriginal", "utf8");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue("<session-title>Current</session-title>\n<answer>\nCurrent answer.\n</answer>")
      }
    });

    const historical = await app.getLog(oldPath);
    expect(historical.readOnly).toBe(true);

    const response = await app.askAssistant("New question");

    expect(await readFile(oldPath, "utf8")).toBe("# Old\n\nOriginal");
    expect(response.log.filePath).not.toBe(oldPath);
    expect(response.log.activeFilePath).toBe(response.log.filePath);
    expect(response.log.readOnly).toBe(false);
    expect(response.log.markdown).toContain("New question");
    expect(response.log.markdown).toContain("Current answer.");
  });

  it("starts a lazy new session without creating an empty transcript", async () => {
    const config = await writeConfig("new-session");
    const chat = vi
      .fn()
      .mockResolvedValueOnce("<session-title>First</session-title>\n<answer>\nFirst answer.\n</answer>")
      .mockResolvedValueOnce("<session-title>Second</session-title>\n<answer>\nSecond answer.\n</answer>");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });
    const first = await app.askAssistant("First question");
    const firstFiles = await readdir(config.logDir);

    const reset = await app.startNewSession();
    const filesAfterReset = await readdir(config.logDir);
    const second = await app.askAssistant("Second question");

    expect(reset.filePath).toBeNull();
    expect(reset.activeFilePath).toBeNull();
    expect(filesAfterReset).toEqual(firstFiles);
    expect(second.log.filePath).not.toBe(first.log.filePath);
    expect(second.log.markdown).toContain("Second question");
    const secondMessages = chat.mock.calls[1]?.[0] as Array<{ content: string }> | undefined;
    expect(secondMessages?.[0]?.content).toContain("<session-title>");
  });

  it("writes assistant failures to console instead of transcript logs", async () => {
    const config = await writeConfig("assistant-error");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      assistant: {
        ask: vi.fn().mockRejectedValue(new Error("provider failed"))
      },
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    await expect(app.askAssistant("Will this fail?")).rejects.toThrow("provider failed");

    expect(app.getConsole().entries.map((entry) => `${entry.level}:${entry.message}`).join("\n")).toContain(
      "error:Assistant response failed: provider failed"
    );
    await expect(readdir(config.logDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects overlapping operations with a busy error", async () => {
    let resolveAsk: (() => void) | undefined;
    const app = createWebApp({
      config: await writeConfig("busy"),
      ...mockRefreshDependencies(),
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
    await vi.waitFor(() => {
      expect(resolveAsk).toBeDefined();
    });
    if (!resolveAsk) {
      throw new Error("Assistant promise was not started.");
    }
    resolveAsk();
    await pending;
  });
});

const mockRefreshDependencies = () => {
  const state = createDefaultRuntimeState();
  const nextState = createDefaultRuntimeState();
  return {
    discovery: {
      inspectSources: vi.fn().mockResolvedValue({
        degraded: false,
        inventories: [],
        nextState
      })
    },
    ingestion: {
      ingest: vi.fn().mockResolvedValue({
        nextState,
        summary: {
          corpusSourceCount: 1,
          degraded: false,
          sourceSummaries: []
        }
      })
    },
    stateStore: {
      load: vi.fn().mockResolvedValue({ state }),
      save: vi.fn().mockResolvedValue(undefined)
    }
  };
};

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

const emptyLogResponse = () => ({
  activeFilePath: null,
  files: [],
  filePath: null,
  markdown: "",
  readOnly: false
});
