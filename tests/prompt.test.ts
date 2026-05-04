import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PassThrough, Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatAdapter } from "../src/provider/index.js";
import { createMemoryProgressReporter } from "../src/progress/reporter.js";
import { type RetrievalService } from "../src/retrieval/index.js";
import { loadDefaultConfig } from "../src/config/index.js";
import { buildNpcGenerationMessages } from "../src/runtime/npc-session.js";
import {
  buildAssistantMessages,
  createAssistantPromptShell,
  formatCitation,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from "../src/runtime/prompt.js";
import type { AssistantConfig, RuntimeConfig } from "../src/types.js";
import type { RetrievalResult } from "../src/types.js";

const TEST_ROOT = path.resolve(".test-tmp", "prompt");
const PROMPT_ASSETS: AssistantPromptAssets = {
  additionalContext: "",
  npcGeneratorPrompt: [
    "You are in NPC generator mode.",
    "For new NPCs, ids must be greater than {{maxExistingId}}."
  ].join("\n"),
  sessionTitlePrompt: [
    "Return exactly this metadata wrapper before every answer.",
    "<session-title>A concise filesystem-safe session title</session-title>",
    "<response-title>A concise heading for this user prompt</response-title>",
    "<answer>",
    "Your normal answer.",
    "</answer>"
  ].join("\n"),
  systemPrompt: [
    "You are Eberron Query Assistant, a terminal-only assistant for Eberron lore and campaign notes.",
    "Answer using the retrieved evidence when it is relevant.",
    "Distinguish direct support from inference. Do not describe synthesized conclusions as quoted facts.",
    "Include concise references when evidence is available.",
    "Use PDF title plus page when present, article title plus URL, and foundry entity name plus type or identifier."
  ].join("\n"),
  worldQueryingModePrompt: [
    "Party context is intentionally omitted.",
    "Treat this request as world querying or world building, not as a question about the current party, current session status, or active party goals."
  ].join("\n")
};

afterEach(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
});

describe("assistant prompt assembly", () => {
  it("separates instructions, evidence, and user question", () => {
    const messages = buildAssistantMessages({
      evidence: [result("pdf", "eberron.pdf", "Eberron Rising", "page 4")],
      promptAssets: PROMPT_ASSETS,
      question: "What does Aerenal do with deathless ancestors?"
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Distinguish direct support from inference");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Retrieved evidence:");
    expect(messages[1]?.content).toContain("Question: What does Aerenal do with deathless ancestors?");
    expect(messages[1]?.content).toContain("Eberron Rising, page 4");
  });

  it("formats mixed citation types", () => {
    expect(formatCitation(result("pdf", "eberron.pdf", "Eberron Rising", "page 4"))).toBe(
      "Eberron Rising, page 4 [pdf:eberron.pdf]"
    );
    expect(
      formatCitation(
        result("article", "https://keith-baker.com/aerenal/", "Aerenal Notes", null, "https://keith-baker.com/aerenal/")
      )
    ).toBe("Aerenal Notes, https://keith-baker.com/aerenal/ [article:https://keith-baker.com/aerenal/]");
    expect(formatCitation(result("foundry", "actor-ashana", "Ashana", "Actor"))).toBe(
      "Ashana, Actor [foundry:actor-ashana]"
    );
  });

  it("tells the model when no evidence was retrieved", () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: "What is unknown?"
    });

    expect(messages.at(-1)?.content).toContain("No relevant retrieval results were found");
  });

  it("includes non-empty local assistant context in the system message", () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: {
        ...PROMPT_ASSETS,
        additionalContext: "The campaign treats Vathirond as politically tense."
      },
      question: "What is happening in Vathirond?"
    });

    expect(messages[0]?.content).toContain("Additional assistant context:");
    expect(messages[0]?.content).toContain("The campaign treats Vathirond as politically tense.");
  });

  it("includes current party context before retrieved evidence", () => {
    const messages = buildAssistantMessages({
      evidence: [result("foundry", "world.actor.peanunt", "Peanunt", "Actor")],
      partyContext: "Current party context:\n- Party actors: Peanunt.",
      promptAssets: PROMPT_ASSETS,
      question: "Who is the party?"
    });

    expect(messages.at(-1)?.content).toContain("Current party context:");
    expect(messages.at(-1)?.content.indexOf("Current party context:")).toBeLessThan(
      messages.at(-1)?.content.indexOf("Retrieved evidence:") ?? 0
    );
  });

  it("omits party context and adds world querying instructions when party context is disabled", () => {
    const messages = buildAssistantMessages({
      evidence: [result("foundry", "world.actor.peanunt", "Peanunt", "Actor")],
      includePartyContext: false,
      partyContext: "Current party context:\n- Party actors: Peanunt.",
      promptAssets: PROMPT_ASSETS,
      question: "Who runs Aundair?"
    });

    expect(messages[0]?.content).toContain("world querying or world building");
    expect(messages.at(-1)?.content).not.toContain("Current party context:");
    expect(messages.at(-1)?.content).toContain("Retrieved evidence:");
  });

  it("omits the local assistant context section when it is empty", () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: "What is happening in Vathirond?"
    });

    expect(messages[0]?.content).not.toContain("Additional assistant context:");
  });

  it("uses the session title prompt only when requested", () => {
    const normalMessages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: "Normal question"
    });
    const firstResponseMessages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: "First question",
      requestSessionTitle: true
    });

    expect(normalMessages[0]?.content).toContain("omit <session-title>");
    expect(normalMessages[0]?.content).toContain("<response-title>");
    expect(firstResponseMessages[0]?.content).toContain("<session-title>");
    expect(firstResponseMessages[0]?.content).toContain("include <session-title>");
  });

  it("loads prompt text from assistant files and creates missing local context", async () => {
    const assistant = await writeAssistantFiles("load-assets", {
      additionalContext: null,
      systemPrompt: "System prompt from disk."
    });

    const loaded = await loadAssistantPromptAssets(assistant);

    expect(loaded.systemPrompt).toBe("System prompt from disk.");
    expect(loaded.sessionTitlePrompt).toContain("<session-title>");
    expect(loaded.npcGeneratorPrompt).toContain("NPC generator mode");
    expect(loaded.worldQueryingModePrompt).toContain("world querying or world building");
    expect(loaded.additionalContext).toBe("");
    await expect(readFile(assistant.additionalContextPath, "utf8")).resolves.toBe("");
  });
});

describe("NPC generator prompt assembly", () => {
  it("includes current party context before retrieved evidence when enabled", () => {
    const messages = buildNpcGenerationMessages({
      evidence: [result("foundry", "world.actor.peanunt", "Peanunt", "Actor")],
      history: [],
      includePartyContext: true,
      maxExistingId: 0,
      npcs: [],
      partyContext: "Current party context:\n- Party actors: Peanunt.",
      prompt: "Generate one NPC",
      promptAssets: PROMPT_ASSETS
    });

    expect(messages.at(-1)?.content).toContain("Current party context:");
    expect(messages.at(-1)?.content.indexOf("Current party context:")).toBeLessThan(
      messages.at(-1)?.content.indexOf("Retrieved evidence:") ?? 0
    );
  });

  it("omits party context and adds world building instructions when disabled", () => {
    const messages = buildNpcGenerationMessages({
      evidence: [result("foundry", "world.actor.peanunt", "Peanunt", "Actor")],
      history: [],
      includePartyContext: false,
      maxExistingId: 0,
      npcs: [],
      partyContext: "Current party context:\n- Party actors: Peanunt.",
      prompt: "Generate one NPC",
      promptAssets: PROMPT_ASSETS
    });

    expect(messages[0]?.content).toContain("world querying or world building");
    expect(messages.at(-1)?.content).not.toContain("Current party context:");
    expect(messages.at(-1)?.content).toContain("Retrieved evidence:");
  });
});

describe("assistant prompt shell", () => {
  it("retrieves evidence and calls chat for user questions", async () => {
    const retrievalFixture = mockRetrieval([result("pdf", "eberron.pdf", "Eberron Rising", "page 4")]);
    const complete = vi
      .fn()
      .mockResolvedValueOnce("Aerenal answer.\nReferences: Eberron Rising, page 4")
      .mockResolvedValueOnce([
        "<session-title>Aerenal</session-title>",
        "<response-title>Aerenal Answer</response-title>",
        "<answer>",
        "Aerenal answer.",
        "References: Eberron Rising, page 4",
        "</answer>"
      ].join("\n"));
    const chat: ChatAdapter = {
      complete
    };
    const output = createWritableCapture();

    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("retrieves-evidence")),
      chat,
      input: Readable.from(["What about Aerenal?\nexit\n"]),
      output,
      reporter: createMemoryProgressReporter(),
      retrieval: retrievalFixture.retrieval
    }).start();

    expect(retrievalFixture.search).toHaveBeenCalledWith({
      query: "What about Aerenal?",
      limit: 8
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(output.text()).toContain("Aerenal answer.");
    expect(output.text()).toContain("\nAerenal answer.\nReferences: Eberron Rising, page 4\n\n");
  });

  it("creates a session transcript from first response title metadata without printing the metadata", async () => {
    const logDir = path.join(TEST_ROOT, "logs-title");
    const complete = vi.fn<ChatAdapter["complete"]>().mockResolvedValue(
      [
        "<session-title>Aerenal Ancestors</session-title>",
        "<response-title>Aerenal Ancestors</response-title>",
        "<answer>",
        "Aerenal answer.",
        "References: Eberron Rising, page 4",
        "</answer>"
      ].join("\n")
    );
    const output = createWritableCapture();

    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-title")),
      chat: { complete },
      input: Readable.from(["What about Aerenal?\nexit\n"]),
      logDir,
      output,
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([result("pdf", "eberron.pdf", "Eberron Rising", "page 4")]).retrieval
    }).start();

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);
    expect(filenames[0]).toMatch(/^\d{14} Aerenal Ancestors\.json$/);
    expect(output.text()).toContain("Aerenal answer.");
    expect(output.text()).not.toContain("<session-title>");

    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ""), "utf8")) as unknown;
    expect(log).toEqual([
      {
        user: "What about Aerenal?",
        title: "Aerenal Ancestors",
        assistant: "Aerenal answer.\nReferences: Eberron Rising, page 4"
      }
    ]);
  });

  it("appends later successful responses to the same session transcript", async () => {
    const logDir = path.join(TEST_ROOT, "logs-append");
    const input = new PassThrough();
    const complete = vi
      .fn<ChatAdapter["complete"]>()
      .mockResolvedValueOnce("<session-title>Dragonmark Notes</session-title>\n<response-title>First Question</response-title>\n<answer>\nFirst answer.\n</answer>")
      .mockResolvedValueOnce("<response-title>Second Question</response-title>\n<answer>\nSecond answer.\n</answer>");
    const output = createWritableCapture();

    const prompt = createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-append")),
      chat: { complete },
      input,
      logDir,
      output,
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    input.write("First question\n");
    await waitForCallCount(complete, 1);
    await waitForPromptCount(output, 2);
    input.write("Second question\n");
    await waitForCallCount(complete, 2);
    await waitForPromptCount(output, 3);
    input.write("exit\n");
    await prompt;

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);

    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ""), "utf8")) as Array<{
      assistant: string;
      title: string;
      user: string;
    }>;
    expect(log).toEqual([
      { user: "First question", title: "First Question", assistant: "First answer." },
      { user: "Second question", title: "Second Question", assistant: "Second answer." }
    ]);
  });

  it("does not create a session transcript when title metadata is missing", async () => {
    const logDir = path.join(TEST_ROOT, "logs-missing-title");
    const reporter = createMemoryProgressReporter();

    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-missing-title")),
      chat: { complete: vi.fn<ChatAdapter["complete"]>().mockResolvedValue("Plain answer.") },
      input: Readable.from(["What/about:Aerenal?\nexit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter,
      retrieval: mockRetrieval([]).retrieval
    }).start();

    await expect(readdir(logDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(reporter.warnings).toContain(
      "Session log update failed: Assistant response did not include required title metadata."
    );
  });

  it("repairs missing title metadata before appending a later transcript exchange", async () => {
    const logDir = path.join(TEST_ROOT, "logs-title-repair");
    const input = new PassThrough();
    const complete = vi
      .fn<ChatAdapter["complete"]>()
      .mockResolvedValueOnce("<session-title>Crafting</session-title>\n<response-title>Setup</response-title>\n<answer>\nFirst answer.\n</answer>")
      .mockResolvedValueOnce("Second answer without tags.")
      .mockResolvedValueOnce("<response-title>Materials</response-title>\n<answer>\nSecond answer without tags.\n</answer>");
    const output = createWritableCapture();

    const prompt = createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-title-repair")),
      chat: { complete },
      input,
      logDir,
      output,
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    input.write("First question\n");
    await waitForCallCount(complete, 1);
    await waitForPromptCount(output, 2);
    input.write("Second question\n");
    await waitForCallCount(complete, 3);
    await waitForPromptCount(output, 3);
    input.write("exit\n");
    await prompt;

    const filenames = await readdir(logDir);
    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ""), "utf8")) as Array<{
      assistant: string;
      title: string;
      user: string;
    }>;
    expect(log[1]).toEqual({
      user: "Second question",
      title: "Materials",
      assistant: "Second answer without tags."
    });
  });

  it("does not create an empty session transcript when the user exits before a response", async () => {
    const logDir = path.join(TEST_ROOT, "logs-empty");

    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-empty")),
      chat: mockChat().chat,
      input: Readable.from(["exit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    await expect(readdir(logDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("starts each shell with empty in-memory history", async () => {
    const firstChat = mockChat();
    const secondChat = mockChat();
    const logDir = path.join(TEST_ROOT, "logs-history");
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, "20260102030405 Old Session.json"), JSON.stringify([{ user: "Old logged question", title: "Old", assistant: "Old answer" }]), "utf8");

    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-history-first")),
      chat: firstChat.chat,
      input: Readable.from(["First question\nexit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();
    await createAssistantPromptShell({
      ...promptShellConfig(await writeAssistantFiles("logs-history-second")),
      chat: secondChat.chat,
      input: Readable.from(["Second question\nexit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    const firstMessages = firstChat.complete.mock.calls[0]?.[0] ?? [];
    const secondMessages = secondChat.complete.mock.calls[0]?.[0] ?? [];
    expect(firstMessages.some((message) => message.content.includes("First question"))).toBe(true);
    expect(secondMessages.some((message) => message.content.includes("First question"))).toBe(false);
    expect(secondMessages.some((message) => message.content.includes("Old logged question"))).toBe(false);
  });
});

const result = (
  sourceType: RetrievalResult["sourceType"],
  sourceKey: string,
  label: string,
  locator: string | null,
  url: string | null = null
): RetrievalResult => ({
  chunkId: `${sourceType}:${sourceKey}:0`,
  sourceId: `${sourceType}:${sourceKey}`,
  sourceType,
  sourceKey,
  sourceTitle: label,
  content: "Aerenal keeps deathless counselors.",
  citation: {
    sourceType,
    label,
    locator,
    url
  },
  score: 0.9,
  matchKind: "hybrid"
});

const mockRetrieval = (
  results: RetrievalResult[]
): { retrieval: RetrievalService; search: ReturnType<typeof vi.fn<RetrievalService["search"]>> } => {
  const search = vi.fn<RetrievalService["search"]>().mockResolvedValue(results);
  return {
    retrieval: {
      refresh: vi.fn().mockResolvedValue({ chunkCount: results.length, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
      search
    },
    search
  };
};

const waitForCallCount = async (fn: { mock: { calls: unknown[] } }, count: number): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fn.mock.calls.length >= count) {
      return;
    }
    await delay(1);
  }
  throw new Error(`Expected mock to be called ${count} time(s), but it was called ${fn.mock.calls.length} time(s).`);
};

const waitForPromptCount = async (output: { text(): string }, count: number): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const prompts = output.text().match(/> /g) ?? [];
    if (prompts.length >= count) {
      return;
    }
    await delay(1);
  }
  throw new Error(`Expected ${count} prompt marker(s), but saw ${output.text()}.`);
};

const mockChat = (): { chat: ChatAdapter; complete: ReturnType<typeof vi.fn<ChatAdapter["complete"]>> } => {
  const complete = vi.fn<ChatAdapter["complete"]>().mockResolvedValue("answer");
  return {
    chat: {
      complete
    },
    complete
  };
};

const createWritableCapture = (): Writable & { text(): string } => {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    }
  }) as Writable & { text(): string };
  writable.text = () => chunks.join("");
  return writable;
};

const writeAssistantFiles = async (
  name: string,
  options: {
    additionalContext?: string | null;
    sessionTitlePrompt?: string;
    systemPrompt?: string;
  } = {}
): Promise<AssistantConfig> => {
  const assistantDir = path.join(TEST_ROOT, "assistant", name);
  const config: AssistantConfig = {
    assistantDir,
    additionalContextPath: path.join(assistantDir, "additional-context.md"),
    npcGeneratorPromptPath: path.join(assistantDir, "npc-generator-prompt.md"),
    sessionTitlePromptPath: path.join(assistantDir, "session-title-prompt.md"),
    systemPromptPath: path.join(assistantDir, "system-prompt.md"),
    worldQueryingModePromptPath: path.join(assistantDir, "world-querying-mode-prompt.md")
  };
  await mkdir(assistantDir, { recursive: true });
  await writeFile(config.systemPromptPath, options.systemPrompt ?? PROMPT_ASSETS.systemPrompt, "utf8");
  await writeFile(config.npcGeneratorPromptPath, PROMPT_ASSETS.npcGeneratorPrompt, "utf8");
  await writeFile(config.worldQueryingModePromptPath, PROMPT_ASSETS.worldQueryingModePrompt, "utf8");
  await writeFile(
    config.sessionTitlePromptPath,
    options.sessionTitlePrompt ?? PROMPT_ASSETS.sessionTitlePrompt,
    "utf8"
  );
  if (options.additionalContext !== null) {
    await writeFile(config.additionalContextPath, options.additionalContext ?? "", "utf8");
  }
  return config;
};

const promptShellConfig = (assistant: AssistantConfig): { assistant: AssistantConfig; config: RuntimeConfig } => {
  const config = loadDefaultConfig(path.join(TEST_ROOT, "runtime", path.basename(assistant.assistantDir)));
  return {
    assistant,
    config: {
      ...config,
      assistant
    }
  };
};
