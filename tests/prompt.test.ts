import { Readable, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { ChatAdapter } from "../src/provider/index.js";
import { createMemoryProgressReporter } from "../src/progress/reporter.js";
import { type RetrievalService } from "../src/retrieval/index.js";
import {
  buildAssistantMessages,
  createAssistantPromptShell,
  formatCitation
} from "../src/runtime/prompt.js";
import type { RetrievalResult } from "../src/types.js";

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

  it("starts each shell with empty in-memory history", async () => {
    const firstChat = mockChat();
    const secondChat = mockChat();

    await createAssistantPromptShell({
      chat: firstChat.chat,
      input: Readable.from(["First question\nexit\n"]),
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();
    await createAssistantPromptShell({
      chat: secondChat.chat,
      input: Readable.from(["Second question\nexit\n"]),
      output: createWritableCapture(),
      reporter: createMemoryProgressReporter(),
      retrieval: mockRetrieval([]).retrieval
    }).start();

    const firstMessages = firstChat.complete.mock.calls[0]?.[0] ?? [];
    const secondMessages = secondChat.complete.mock.calls[0]?.[0] ?? [];
    expect(firstMessages.some((message) => message.content.includes("First question"))).toBe(true);
    expect(secondMessages.some((message) => message.content.includes("First question"))).toBe(false);
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
