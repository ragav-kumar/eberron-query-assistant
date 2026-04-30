import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PassThrough, Readable, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatAdapter } from "../src/provider/index.js";
import { createMemoryProgressReporter } from "../src/progress/reporter.js";
import { type RetrievalService } from "../src/retrieval/index.js";
import {
  buildAssistantMessages,
  createAssistantPromptShell,
  formatCitation
} from "../src/runtime/prompt.js";
import type { RetrievalResult } from "../src/types.js";

const TEST_ROOT = path.resolve(".test-tmp", "prompt");

afterEach(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
});

describe("assistant prompt assembly", () => {
  it("separates instructions, evidence, and user question", () => {
    const messages = buildAssistantMessages({
      evidence: [result("pdf", "eberron.pdf", "Eberron Rising", "page 4")],
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
      question: "What is unknown?"
    });

    expect(messages.at(-1)?.content).toContain("No relevant retrieval results were found");
  });
});

describe("assistant prompt shell", () => {
  it("retrieves evidence and calls chat for user questions", async () => {
    const retrievalFixture = mockRetrieval([result("pdf", "eberron.pdf", "Eberron Rising", "page 4")]);
    const complete = vi.fn().mockResolvedValue("Aerenal answer.\nReferences: Eberron Rising, page 4");
    const chat: ChatAdapter = {
      complete
    };
    const output = createWritableCapture();

    await createAssistantPromptShell({
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
    expect(complete).toHaveBeenCalledOnce();
    expect(output.text()).toContain("Aerenal answer.");
    expect(output.text()).toContain("\nAerenal answer.\nReferences: Eberron Rising, page 4\n\n");
  });

  it("creates a session transcript from first response title metadata without printing the metadata", async () => {
    const logDir = path.join(TEST_ROOT, "logs-title");
    const complete = vi.fn<ChatAdapter["complete"]>().mockResolvedValue(
      [
        "<session-title>Aerenal Ancestors</session-title>",
        "<answer>",
        "Aerenal answer.",
        "References: Eberron Rising, page 4",
        "</answer>"
      ].join("\n")
    );
    const output = createWritableCapture();

    await createAssistantPromptShell({
      chat: { complete },
      input: Readable.from(["What about Aerenal?\nexit\n"]),
      logDir,
      output,
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([result("pdf", "eberron.pdf", "Eberron Rising", "page 4")]).retrieval
    }).start();

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);
    expect(filenames[0]).toMatch(/^\d{14} Aerenal Ancestors\.md$/);
    expect(output.text()).toContain("Aerenal answer.");
    expect(output.text()).not.toContain("<session-title>");

    const logText = await readFile(path.join(logDir, filenames[0] ?? ""), "utf8");
    expect(logText).toContain("# Aerenal Ancestors");
    expect(logText).toContain("## User\n\nWhat about Aerenal?");
    expect(logText).toContain("## Assistant\n\nAerenal answer.\nReferences: Eberron Rising, page 4");
    expect(logText).not.toContain("<answer>");
  });

  it("appends later successful responses to the same session transcript", async () => {
    const logDir = path.join(TEST_ROOT, "logs-append");
    const input = new PassThrough();
    const complete = vi
      .fn<ChatAdapter["complete"]>()
      .mockResolvedValueOnce("<session-title>Dragonmark Notes</session-title>\n<answer>\nFirst answer.\n</answer>")
      .mockResolvedValueOnce("Second answer.");
    const output = createWritableCapture();

    const prompt = createAssistantPromptShell({
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

    const logText = await readFile(path.join(logDir, filenames[0] ?? ""), "utf8");
    expect(logText.match(/## User/g)).toHaveLength(2);
    expect(logText).toContain("First question");
    expect(logText).toContain("First answer.");
    expect(logText).toContain("Second question");
    expect(logText).toContain("Second answer.");
  });

  it("falls back to a sanitized first-question title when title metadata is missing", async () => {
    const logDir = path.join(TEST_ROOT, "logs-fallback");

    await createAssistantPromptShell({
      chat: { complete: vi.fn<ChatAdapter["complete"]>().mockResolvedValue("Plain answer.") },
      input: Readable.from(["What/about:Aerenal?\nexit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);
    expect(filenames[0]).toMatch(/^\d{14} What about Aerenal\.md$/);
  });

  it("does not create an empty session transcript when the user exits before a response", async () => {
    const logDir = path.join(TEST_ROOT, "logs-empty");

    await createAssistantPromptShell({
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
    await writeFile(path.join(logDir, "20260102030405 Old Session.md"), "Old logged question", "utf8");

    await createAssistantPromptShell({
      chat: firstChat.chat,
      input: Readable.from(["First question\nexit\n"]),
      logDir,
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();
    await createAssistantPromptShell({
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
