import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createWebApp, isBusyError, isWebOperationError } from "../src/server/app.js";
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

    expect(path.basename(response.log.filePath ?? "")).toContain("Aerenal");
    expect(path.basename(response.log.filePath ?? "")).not.toContain("GUI Session");
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

  it("reports idle status snapshots with console, log, and NPC state", async () => {
    const app = createWebApp({
      config: await writeConfig("idle-status"),
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const status = await app.getStatus();

    expect(status.activeOperation).toBeNull();
    expect(status.console.entries).toEqual([]);
    expect(status.log).toEqual(emptyLogResponse());
    expect(status.npcs).toEqual({ npcs: [] });
  });

  it("reports active operation status while refresh is running", async () => {
    const config = await writeConfig("active-status");
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    let resolveIngest: ((value: {
      nextState: typeof nextState;
      summary: {
        corpusSourceCount: number;
        degraded: boolean;
        sourceSummaries: [];
      };
    }) => void) | undefined;
    const ingest = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveIngest = resolve;
    }));
    const app = createWebApp({
      config,
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: false,
          nextState,
          inventories: []
        })
      },
      ingestion: { ingest },
      retrieval: mockRetrieval([]).retrieval,
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      },
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const pending = app.refresh(true);
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalled();
    });

    const status = await app.getStatus();

    expect(status.activeOperation).toBe("force-reingest");
    expect(status.console.entries.map((entry) => entry.message).join("\n")).toContain("Force re-ingest requested");

    resolveIngest?.({
      nextState,
      summary: {
        corpusSourceCount: 1,
        degraded: false,
        sourceSummaries: []
      }
    });
    await pending;
    expect((await app.getStatus()).activeOperation).toBeNull();
  });

  it("replays existing console entries to new subscribers before streaming new ones", async () => {
    const config = await writeConfig("console-replay");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });
    await app.refresh(false);
    const streamedMessages: string[] = [];

    const unsubscribe = app.subscribeConsole((entry) => {
      streamedMessages.push(entry.message);
    });
    await app.debugRetrieval("aerenal");

    expect(streamedMessages.some((message) => message.includes("Refresh complete"))).toBe(true);
    expect(streamedMessages.some((message) => message.includes("Debug retrieval query: aerenal"))).toBe(true);
    unsubscribe();
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

  it("reads missing generated NPC state as an empty list", async () => {
    const app = createWebApp({
      config: await writeConfig("npc-state-missing"),
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    expect(await app.getNpcs()).toEqual({ npcs: [] });
  });

  it("reads saved generated NPC state newest first", async () => {
    const config = await writeConfig("npc-state-read");
    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      path.join(config.stateDir, "generated-npcs.json"),
      JSON.stringify([
        {
          id: 1,
          name: "Older",
          description: "An older NPC.",
          bio: "They were saved first.",
          createdAt: "2026-05-01T12:00:00.000Z",
          updatedAt: "2026-05-01T12:00:00.000Z"
        },
        {
          id: 2,
          name: "Newer",
          description: "A newer NPC.",
          bio: "They were saved second.",
          createdAt: "2026-05-02T12:00:00.000Z",
          updatedAt: "2026-05-02T12:00:00.000Z"
        }
      ]),
      "utf8"
    );
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    expect((await app.getNpcs()).npcs.map((npc) => npc.name)).toEqual(["Newer", "Older"]);
  });

  it("rejects malformed or duplicate generated NPC state", async () => {
    const malformed = await writeConfig("npc-state-malformed");
    await mkdir(malformed.stateDir, { recursive: true });
    await writeFile(path.join(malformed.stateDir, "generated-npcs.json"), "{}", "utf8");
    const duplicate = await writeConfig("npc-state-duplicate");
    await mkdir(duplicate.stateDir, { recursive: true });
    await writeFile(
      path.join(duplicate.stateDir, "generated-npcs.json"),
      JSON.stringify([
        {
          id: 1,
          name: "First",
          description: "First NPC.",
          bio: "First bio.",
          createdAt: "2026-05-01T12:00:00.000Z",
          updatedAt: "2026-05-01T12:00:00.000Z"
        },
        {
          id: 1,
          name: "Second",
          description: "Second NPC.",
          bio: "Second bio.",
          createdAt: "2026-05-02T12:00:00.000Z",
          updatedAt: "2026-05-02T12:00:00.000Z"
        }
      ]),
      "utf8"
    );

    await expect(createWebApp({
      config: malformed,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    }).getNpcs()).rejects.toThrow(
      "Generated NPC state file must contain a JSON array."
    );
    await expect(createWebApp({
      config: duplicate,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    }).getNpcs()).rejects.toThrow(
      "Generated NPC state file contains duplicate NPC ids."
    );
  });

  it("migrates legacy generated NPC Markdown into runtime state", async () => {
    const config = await writeConfig("npc-state-migration");
    await mkdir(config.logDir, { recursive: true });
    await writeFile(
      path.join(config.logDir, "generated_npcs.md"),
      [
        "## NPC Generation",
        "",
        "Prompt: Generate one NPC",
        "",
        "### 1. Father Halven ir'Bradd",
        "",
        "Description: Lean, middle-aged human priest.",
        "",
        "Bio: He keeps Vathirond organized.",
        ""
      ].join("\n"),
      "utf8"
    );
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    expect((await app.getNpcs()).npcs).toEqual([
      {
        id: 1,
        name: "Father Halven ir'Bradd",
        description: "Lean, middle-aged human priest.",
        bio: "He keeps Vathirond organized."
      }
    ]);
    expect(await readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8")).toContain("Father Halven ir'Bradd");
    expect(await readFile(path.join(config.logDir, "generated_npcs.md"), "utf8")).toContain("## NPC Generation");
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

    const reset = await app.getLog({ sessionId: "second" });
    const filesAfterReset = await readdir(config.logDir);
    const second = await app.askAssistant("Second question", "second");

    expect(reset.filePath).toBeNull();
    expect(reset.activeFilePath).toBeNull();
    expect(filesAfterReset).toEqual(firstFiles);
    expect(second.log.filePath).not.toBe(first.log.filePath);
    expect(path.basename(first.log.filePath ?? "")).toContain("First");
    expect(path.basename(second.log.filePath ?? "")).toContain("Second");
    expect(second.log.markdown).toContain("Second question");
    const secondMessages = chat.mock.calls[1]?.[0] as Array<{ content: string }> | undefined;
    expect(secondMessages?.[0]?.content).toContain("<session-title>");
  });

  it("falls back to the submitted question when the first response has no session title", async () => {
    const app = createWebApp({
      config: await writeConfig("fallback-title"),
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue("Plain answer.")
      }
    });

    const response = await app.askAssistant("What about the Mournland?");

    expect(path.basename(response.log.filePath ?? "")).toContain("What about the Mournland");
    expect(path.basename(response.log.filePath ?? "")).not.toContain("GUI Session");
    expect(response.log.markdown).toContain("Plain answer.");
  });

  it("generates NPC cards, writes generated NPC state, and keeps transcript logs separate", async () => {
    const config = await writeConfig("npcs");
    const retrievalFixture = mockRetrieval([result()]);
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: retrievalFixture.retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue(
          JSON.stringify({
            npcs: [
              {
                id: 1,
                name: "Jala ir'Wynarn",
                description: "A sharp-eyed Aundairian envoy in travel-stained blue.",
                bio: "She trades favors along the border."
              }
            ]
          })
        )
      }
    });

    const response = await app.generateNpcs("Generate one Aundairian envoy");

    expect(response.npcs.npcs).toEqual([
      {
        id: 1,
        name: "Jala ir'Wynarn",
        description: "A sharp-eyed Aundairian envoy in travel-stained blue.",
        bio: "She trades favors along the border."
      }
    ]);
    expect(retrievalFixture.retrieval.refresh).toHaveBeenCalledWith(config, { forceRebuild: false });
    const stateText = await readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8");
    expect(stateText).toContain("\"name\": \"Jala ir'Wynarn\"");
    expect(stateText).toContain("\"createdAt\"");
    expect(response.log.files.map((file) => file.label)).not.toContain("generated_npcs.md");
    expect(response.log).toEqual(emptyLogResponse());
  });

  it("patches saved NPC cards by id without duplicating revisions", async () => {
    const config = await writeConfig("npc-patch");
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          npcs: [
            {
              id: 1,
              name: "Graak",
              description: "A goblin courier with soot-dark leathers.",
              bio: "He knows the fastest alleys."
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          npcs: [
            {
              id: 1,
              name: "Gara ir'Lantar",
              description: "A polished Aundairian goblin with a duelist's posture.",
              bio: "She carries messages for a minor arcane house."
            },
            {
              id: 2,
              name: "Tavin d'Orien",
              description: "A broad-shouldered courier with a marked palm.",
              bio: "He keeps her routes discreet."
            }
          ]
        })
      );
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    await app.generateNpcs("Generate a goblin NPC");
    const response = await app.generateNpcs("Make that goblin native to Aundair and add a contact");

    expect(response.npcs.npcs.map((npc) => `${npc.id}:${npc.name}`)).toEqual(["2:Tavin d'Orien", "1:Gara ir'Lantar"]);
    const state = JSON.parse(await readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8")) as Array<{ id: number; name: string }>;
    expect(state.map((npc) => `${npc.id}:${npc.name}`)).toEqual(["1:Gara ir'Lantar", "2:Tavin d'Orien"]);
    expect(state.some((npc) => npc.name === "Graak")).toBe(false);
  });

  it("starts fresh NPC generation context without deleting generated NPC state", async () => {
    const config = await writeConfig("npc-new-session");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue(
          JSON.stringify({
            npcs: [
              {
                id: 1,
                name: "Jala ir'Wynarn",
                description: "A sharp-eyed Aundairian envoy.",
                bio: "She trades favors."
              }
            ]
          })
        )
      }
    });

    await app.generateNpcs("Generate one Aundairian envoy");
    const reset = await app.generateNpcs("Generate one Aundairian envoy", "second-npc-session");

    expect(reset.npcs.npcs).toHaveLength(1);
    expect(reset.npcs.npcs[0]?.id).toBe(1);
    expect(await readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8")).toContain("Jala ir'Wynarn");
  });

  it("switches between standard and NPC sessions without keeping parallel session state", async () => {
    const config = await writeConfig("session-switch");
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          npcs: [
            {
              id: 1,
              name: "Jala ir'Wynarn",
              description: "A sharp-eyed Aundairian envoy.",
              bio: "She trades favors."
            }
          ]
        })
      )
      .mockResolvedValueOnce("<session-title>Standard</session-title>\n<answer>\nStandard answer.\n</answer>");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    const npcResponse = await app.generateNpcs("Generate one envoy", "npc-session");
    const assistantResponse = await app.askAssistant("What about Aerenal?");

    expect(npcResponse.npcs.npcs).toHaveLength(1);
    expect(assistantResponse.npcs.npcs).toHaveLength(1);
    expect(assistantResponse.npcs.npcs[0]?.name).toBe("Jala ir'Wynarn");
    expect(assistantResponse.log.markdown).toContain("Standard answer.");
  });

  it("rejects empty NPC prompts", async () => {
    const app = createWebApp({
      config: await writeConfig("empty-npc"),
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("{}") }
    });

    await expect(app.generateNpcs("   ")).rejects.toThrow("NPC generation prompt cannot be empty.");
  });

  it("writes NPC failures to operation errors instead of generated NPC state", async () => {
    const config = await writeConfig("npc-error");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("not json") }
    });

    try {
      await app.generateNpcs("Generate one NPC");
      throw new Error("Expected NPC generation to fail.");
    } catch (error) {
      expect(isWebOperationError(error)).toBe(true);
      if (!isWebOperationError(error)) {
        throw error;
      }
      expect(error.console.entries.some((entry) => entry.message.includes("NPC generation failed:"))).toBe(true);
      expect(error.message.length).toBeGreaterThan(0);
    }
    await expect(readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("writes assistant failures to operation errors instead of transcript logs", async () => {
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

    try {
      await app.askAssistant("Will this fail?");
      throw new Error("Expected assistant prompt to fail.");
    } catch (error) {
      expect(isWebOperationError(error)).toBe(true);
      if (!isWebOperationError(error)) {
        throw error;
      }
      expect(error.console.entries.some((entry) => entry.message.includes("Assistant response failed: provider failed"))).toBe(true);
      expect(error.message).toBe("provider failed");
    }

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

  it("streams console entries before a long-running operation resolves", async () => {
    let resolveAsk: (() => void) | undefined;
    const app = createWebApp({
      config: await writeConfig("console-subscribe"),
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
    const streamedMessages: string[] = [];
    const unsubscribe = app.subscribeConsole((entry) => {
      streamedMessages.push(entry.message);
    });

    const pending = app.askAssistant("Slow question");

    await vi.waitFor(() => {
      expect(streamedMessages.some((message) => message.includes("No completed refresh found"))).toBe(true);
      expect(resolveAsk).toBeDefined();
    });
    expect(streamedMessages.some((message) => message.includes("No completed refresh found"))).toBe(true);
    resolveAsk?.();
    await pending;
    unsubscribe();
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
