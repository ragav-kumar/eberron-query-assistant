import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import type { ChatMessage } from "../src/provider/index.js";
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
        complete: vi.fn().mockResolvedValue(firstAnswer("Aerenal", "Aerenal Overview", "Aerenal answer."))
      }
    });

    const response = await app.askAssistant("What about Aerenal?");

    expect(path.basename(response.log.filePath ?? "")).toContain("Aerenal");
    expect(path.basename(response.log.filePath ?? "")).not.toContain("GUI Session");
    expect(response.log.exchanges).toEqual([
      {
        user: "What about Aerenal?",
        title: "Aerenal Overview",
        assistant: "Aerenal answer."
      }
    ]);
  });

  it("writes structured timing spans for assistant operations", async () => {
    const config = await writeConfig("assistant-timing");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue(firstAnswer("Timing", "Timing Check", "Timing answer."))
      }
    });

    await app.askAssistant("How long does this take?");

    const timingLog = await readFile(path.join(config.repoRoot, ".test-tmp", "timing.jsonl"), "utf8");
    const entries = timingLog.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { label: string; ok: boolean });

    expect(entries.map((entry) => entry.label)).toEqual(expect.arrayContaining([
      "web.operation",
      "web.refresh.ensure",
      "web.assistant.ask",
      "assistant.retrieval.search",
      "assistant.chat.complete",
      "assistant.log.append_exchange"
    ]));
    expect(entries.every((entry) => entry.ok)).toBe(true);
  });

  it("passes included party context into assistant prompts by default", async () => {
    const partyContextBuild = vi.fn().mockResolvedValue("Current party context:\n- Party actors: Peanunt.");
    const chat = vi.fn().mockResolvedValue(firstAnswer("Party", "Party Question", "Party answer."));
    const app = createWebApp({
      config: await writeConfig("assistant-party-default"),
      ...mockRefreshDependencies(),
      partyContext: { build: partyContextBuild },
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    await app.askAssistant("Who is with the party?");

    expect(partyContextBuild).toHaveBeenCalledOnce();
    expect(readChatMessages(chat).at(-1)?.content).toContain("Current party context:");
  });

  it("omits party context from assistant prompts when requested", async () => {
    const partyContextBuild = vi.fn().mockResolvedValue("Current party context:\n- Party actors: Peanunt.");
    const chat = vi.fn().mockResolvedValue(firstAnswer("World", "World Question", "World answer."));
    const app = createWebApp({
      config: await writeConfig("assistant-party-disabled"),
      ...mockRefreshDependencies(),
      partyContext: { build: partyContextBuild },
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    await app.askAssistant("Who rules Aundair?", undefined, false);

    expect(partyContextBuild).not.toHaveBeenCalled();
    expect(readChatMessages(chat)[0]?.content).toContain("world querying or world building");
    expect(readChatMessages(chat).at(-1)?.content).not.toContain("Current party context:");
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

  it("starts routine refresh in the background and reports startup-refresh status", async () => {
    const config = await writeConfig("startup-refresh");
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

    app.startStartupRefresh();
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalled();
    });

    expect((await app.getStatus()).activeOperation).toBe("startup-refresh");
    await expect(app.askAssistant("What about Aerenal?")).rejects.toSatisfy(isBusyError);
    await expect(app.refresh(false)).rejects.toSatisfy(isBusyError);

    resolveIngest?.({
      nextState,
      summary: {
        corpusSourceCount: 1,
        degraded: false,
        sourceSummaries: []
      }
    });
    await vi.waitFor(async () => {
      expect((await app.getStatus()).activeOperation).toBeNull();
    });
  });

  it("does not run routine refresh again on the first prompt after startup refresh completes", async () => {
    const config = await writeConfig("startup-refresh-before-prompt");
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    const refresh = vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 1, regeneratedEmbeddings: 0 });
    const chat = vi.fn().mockResolvedValue(firstAnswer("Aerenal", "Aerenal Question", "Aerenal answer."));
    const app = createWebApp({
      config,
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: false,
          nextState,
          inventories: []
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
      retrieval: {
        refresh,
        search: vi.fn().mockResolvedValue([result()])
      },
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      },
      chat: { complete: chat }
    });

    app.startStartupRefresh();
    await vi.waitFor(async () => {
      expect((await app.getStatus()).activeOperation).toBeNull();
    });
    const response = await app.askAssistant("What about Aerenal?");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(response.log.exchanges[0]?.assistant).toBe("Aerenal answer.");
  });

  it("logs startup refresh failures and lets later prompts retry refresh", async () => {
    const config = await writeConfig("startup-refresh-failure");
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    const inspectSources = vi
      .fn()
      .mockRejectedValueOnce(new Error("inventory failed"))
      .mockResolvedValueOnce({
        degraded: false,
        nextState,
        inventories: []
      });
    const app = createWebApp({
      config,
      discovery: { inspectSources },
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
      retrieval: mockRetrieval([result()]).retrieval,
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      },
      chat: { complete: vi.fn().mockResolvedValue(firstAnswer("Retry", "Retry Question", "Retry answer.")) }
    });

    app.startStartupRefresh();
    await vi.waitFor(async () => {
      const status = await app.getStatus();
      expect(status.activeOperation).toBeNull();
      expect(status.console.entries.some((entry) => entry.message.includes("Startup refresh failed: inventory failed"))).toBe(true);
    });
    const response = await app.askAssistant("Can this retry?");

    expect(inspectSources).toHaveBeenCalledTimes(2);
    expect(response.log.exchanges[0]?.assistant).toBe("Retry answer.");
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
    await app.refresh(true);

    expect(streamedMessages.some((message) => message.includes("Refresh complete"))).toBe(true);
    expect(streamedMessages.some((message) => message.includes("Force re-ingest requested"))).toBe(true);
    unsubscribe();
  });

  it("lists JSON logs newest first and reads selected historical logs", async () => {
    const config = await writeConfig("log-browser");
    await mkdir(config.logDir, { recursive: true });
    await writeFile(path.join(config.logDir, "20260101000000 Old.json"), JSON.stringify([{ user: "Old?", title: "Old", assistant: "Old." }]), "utf8");
    await writeFile(path.join(config.logDir, "20260201000000 New.json"), JSON.stringify([{ user: "New?", title: "New", assistant: "New." }]), "utf8");
    await writeFile(path.join(config.logDir, "notes.txt"), "not a transcript", "utf8");
    await writeFile(path.join(config.logDir, "legacy.md"), "# Legacy", "utf8");
    await mkdir(path.join(config.logDir, "nested"), { recursive: true });
    await writeFile(path.join(config.logDir, "nested", "20260301000000 Nested.json"), "[]", "utf8");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    const response = await app.getLog(path.join(config.logDir, "20260101000000 Old.json"));

    expect(response.exchanges).toEqual([{ user: "Old?", title: "Old", assistant: "Old." }]);
    expect(response.readOnly).toBe(true);
    expect(response.files.map((file) => file.label)).toEqual([
      "Feb 1, 2026 12:00 AM - New",
      "Jan 1, 2026 12:00 AM - Old"
    ]);
  });

  it("rejects unsafe or missing log selections", async () => {
    const config = await writeConfig("unsafe-log-selection");
    await mkdir(config.logDir, { recursive: true });
    await writeFile(path.join(config.logDir, "20260101000000 Old.json"), "[]", "utf8");
    const app = createWebApp({
      config,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    });

    await expect(app.getLog(path.join(config.logDir, "nested", "Bad.json"))).rejects.toThrow(
      "Selected log file must be a JSON file directly inside the log directory."
    );
    await expect(app.getLog(path.join(config.logDir, "..", "Bad.json"))).rejects.toThrow(
      "Selected log file must be a JSON file directly inside the log directory."
    );
    await expect(app.getLog(path.join(config.logDir, "missing.json"))).rejects.toMatchObject({ code: "ENOENT" });
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
          species: "Human",
          ethnicity: "Aundairian",
          gender: "woman",
          role: "envoy",
          age: "middle-aged",
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

    expect((await app.getNpcs()).npcs).toEqual([
      {
        id: 2,
        name: "Newer",
        species: "Human",
        ethnicity: "Aundairian",
        gender: "woman",
        role: "envoy",
        age: "middle-aged",
        description: "A newer NPC.",
        bio: "They were saved second."
      },
      {
        id: 1,
        name: "Older",
        description: "An older NPC.",
        bio: "They were saved first."
      }
    ]);
  });

  it("rejects malformed, invalid optional detail, or duplicate generated NPC state", async () => {
    const malformed = await writeConfig("npc-state-malformed");
    await mkdir(malformed.stateDir, { recursive: true });
    await writeFile(path.join(malformed.stateDir, "generated-npcs.json"), "{}", "utf8");
    const invalidDetail = await writeConfig("npc-state-invalid-detail");
    await mkdir(invalidDetail.stateDir, { recursive: true });
    await writeFile(
      path.join(invalidDetail.stateDir, "generated-npcs.json"),
      JSON.stringify([
        {
          id: 1,
          name: "Invalid",
          species: ["human"],
          description: "Invalid NPC.",
          bio: "Invalid bio.",
          createdAt: "2026-05-01T12:00:00.000Z",
          updatedAt: "2026-05-01T12:00:00.000Z"
        }
      ]),
      "utf8"
    );
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
      config: invalidDetail,
      retrieval: mockRetrieval([]).retrieval,
      chat: { complete: vi.fn().mockResolvedValue("answer") }
    }).getNpcs()).rejects.toThrow(
      "Generated NPC state file contains an invalid NPC record."
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
    const oldPath = path.join(config.logDir, "20260101000000 Old.json");
    await writeFile(oldPath, JSON.stringify([{ user: "Old?", title: "Old", assistant: "Original" }]), "utf8");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue(firstAnswer("Current", "Current Question", "Current answer."))
      }
    });

    const historical = await app.getLog(oldPath);
    expect(historical.readOnly).toBe(true);

    const response = await app.askAssistant("New question");

    expect(JSON.parse(await readFile(oldPath, "utf8"))).toEqual([{ user: "Old?", title: "Old", assistant: "Original" }]);
    expect(response.log.filePath).not.toBe(oldPath);
    expect(response.log.activeFilePath).toBe(response.log.filePath);
    expect(response.log.readOnly).toBe(false);
    expect(response.log.exchanges[0]).toEqual({
      user: "New question",
      title: "Current Question",
      assistant: "Current answer."
    });
  });

  it("starts a lazy new session without creating an empty transcript", async () => {
    const config = await writeConfig("new-session");
    const chat = vi
      .fn()
      .mockResolvedValueOnce(firstAnswer("First", "First Question", "First answer."))
      .mockResolvedValueOnce(firstAnswer("Second", "Second Question", "Second answer."));
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
    expect(second.log.exchanges[0]?.user).toBe("Second question");
    const secondMessages = chat.mock.calls[1]?.[0] as Array<{ content: string }> | undefined;
    expect(secondMessages?.[0]?.content).toContain("<session-title>");
    expect(secondMessages?.[0]?.content).toContain("<response-title>");
  });

  it("uses assistant response title for the transcript filename when session title is omitted", async () => {
    const app = createWebApp({
      config: await writeConfig("response-title-filename"),
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue([
          "<response-title>Mournland Overview</response-title>",
          "<answer>",
          "Plain answer.",
          "</answer>"
        ].join("\n"))
      }
    });

    const response = await app.askAssistant("What about the Mournland?");

    expect(path.basename(response.log.filePath ?? "")).toContain("Mournland Overview");
    expect(path.basename(response.log.filePath ?? "")).not.toContain("What about the Mournland");
    expect(path.basename(response.log.filePath ?? "")).not.toContain("GUI Session");
    expect(response.log.exchanges[0]).toEqual({
      user: "What about the Mournland?",
      title: "Mournland Overview",
      assistant: "Plain answer."
    });
  });

  it("rejects assistant responses without title metadata instead of using the prompt as a filename", async () => {
    const config = await writeConfig("missing-title");
    const app = createWebApp({
      config,
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue("Plain answer.")
      }
    });

    await expect(app.askAssistant("What about the Mournland?")).rejects.toMatchObject({
      message: "Assistant response did not include required title metadata."
    });
    await expect(readdir(config.logDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("repairs missing second-response title metadata through the assistant", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(firstAnswer("Spark Crafting", "Crafting Setup", "First answer."))
      .mockResolvedValueOnce("Second answer without tags.")
      .mockResolvedValueOnce([
        "<response-title>Crafting Materials</response-title>",
        "<answer>",
        "Second answer without tags.",
        "</answer>"
      ].join("\n"));
    const app = createWebApp({
      config: await writeConfig("second-title-repair"),
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    await app.askAssistant("Set up Spark crafting.");
    const response = await app.askAssistant("What materials should be available?");

    expect(chat).toHaveBeenCalledTimes(3);
    expect(response.log.exchanges[1]).toEqual({
      user: "What materials should be available?",
      title: "Crafting Materials",
      assistant: "Second answer without tags."
    });
  });

  it("caps long assistant-provided transcript filenames", async () => {
    const longTitle = "Spark crafting materials and faster downtime rules for a chronically underfunded artificer party";
    const app = createWebApp({
      config: await writeConfig("long-assistant-title"),
      ...mockRefreshDependencies(),
      retrieval: mockRetrieval([result()]).retrieval,
      chat: {
        complete: vi.fn().mockResolvedValue(firstAnswer(longTitle, longTitle, "Crafting answer."))
      }
    });

    const response = await app.askAssistant("I want setup a smoother crafting system for Spark.");
    const filename = path.basename(response.log.filePath ?? "");

    expect(filename).toContain("Spark crafting materials");
    expect(filename).not.toContain("I want setup");
    expect(filename.length).toBeLessThanOrEqual(100);
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
                species: "Human",
                ethnicity: "Aundairian",
                gender: "woman",
                role: "envoy",
                age: "about 40",
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
        species: "Human",
        ethnicity: "Aundairian",
        gender: "woman",
        role: "envoy",
        age: "about 40",
        description: "A sharp-eyed Aundairian envoy in travel-stained blue.",
        bio: "She trades favors along the border."
      }
    ]);
    expect(retrievalFixture.retrieval.refresh).toHaveBeenCalledWith(config, { forceRebuild: false });
    const stateText = await readFile(path.join(config.stateDir, "generated-npcs.json"), "utf8");
    expect(stateText).toContain("\"name\": \"Jala ir'Wynarn\"");
    expect(stateText).toContain("\"species\": \"Human\"");
    expect(stateText).toContain("\"createdAt\"");
    expect(response.log.files.map((file) => file.label)).not.toContain("generated_npcs.md");
    expect(response.log).toEqual(emptyLogResponse());
  });

  it("passes included party context into NPC generation prompts", async () => {
    const partyContextBuild = vi.fn().mockResolvedValue("Current party context:\n- Party actors: Peanunt.");
    const chat = vi.fn().mockResolvedValue(
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
    );
    const app = createWebApp({
      config: await writeConfig("npc-party-enabled"),
      ...mockRefreshDependencies(),
      partyContext: { build: partyContextBuild },
      retrieval: mockRetrieval([result()]).retrieval,
      chat: { complete: chat }
    });

    await app.generateNpcs("Generate one envoy", undefined, true);

    expect(partyContextBuild).toHaveBeenCalledOnce();
    expect(readChatMessages(chat).at(-1)?.content).toContain("Current party context:");
  });

  it("normalizes empty optional NPC details and rejects invalid generated detail values", async () => {
    const config = await writeConfig("npc-details-normalization");
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          npcs: [
            {
              id: 1,
              name: "  Jala ir'Wynarn  ",
              species: " Human ",
              ethnicity: "",
              gender: "   ",
              role: " Envoy ",
              age: " about 40 ",
              description: " A sharp-eyed Aundairian envoy. ",
              bio: " She trades favors. "
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          npcs: [
            {
              id: 2,
              name: "Invalid",
              species: 42,
              description: "Invalid NPC.",
              bio: "Invalid bio."
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

    const response = await app.generateNpcs("Generate one Aundairian envoy");

    expect(response.npcs.npcs).toEqual([
      {
        id: 1,
        name: "Jala ir'Wynarn",
        species: "Human",
        role: "Envoy",
        age: "about 40",
        description: "A sharp-eyed Aundairian envoy.",
        bio: "She trades favors."
      }
    ]);
    await expect(app.generateNpcs("Generate invalid NPC")).rejects.toMatchObject({
      message: "NPC generation response included an invalid NPC record."
    });
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
      .mockResolvedValueOnce(firstAnswer("Standard", "Standard Question", "Standard answer."));
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
    expect(assistantResponse.log.exchanges[0]?.assistant).toBe("Standard answer.");
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
    await expect(app.refresh(false)).rejects.toSatisfy(isBusyError);
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
  await writeFile(
    config.assistant.npcGeneratorPromptPath,
    [
      "You are in NPC generator mode.",
      "Return only strict JSON with this exact shape: {\"npcs\":[{\"id\":number,\"name\":\"...\",\"description\":\"...\",\"bio\":\"...\"}]}",
      "For new NPCs, ids must be greater than {{maxExistingId}}."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    config.assistant.sessionTitlePromptPath,
    "<session-title>Title</session-title><response-title>Heading</response-title><answer>Answer</answer>",
    "utf8"
  );
  await writeFile(
    config.assistant.worldQueryingModePromptPath,
    [
      "Party context is intentionally omitted.",
      "Treat this request as world querying or world building, not as a question about the current party, current session status, or active party goals."
    ].join("\n"),
    "utf8"
  );
  return config;
};

const readChatMessages = (chat: ReturnType<typeof vi.fn>): ChatMessage[] => {
  return (chat.mock.calls[0]?.[0] ?? []) as ChatMessage[];
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

const firstAnswer = (sessionTitle: string, responseTitle: string, answer: string): string => [
  `<session-title>${sessionTitle}</session-title>`,
  `<response-title>${responseTitle}</response-title>`,
  "<answer>",
  answer,
  "</answer>"
].join("\n");

const emptyLogResponse = () => ({
  activeFilePath: null,
  exchanges: [],
  files: [],
  filePath: null,
  readOnly: false
});
