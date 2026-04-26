import { createInterface } from "node:readline/promises";

import type { Readable, Writable } from "node:stream";

import { formatThrownValue, hasErrorName } from "../errors.js";
import type { ChatAdapter, ChatMessage } from "../provider/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { RetrievalResult } from "../types.js";

export interface PromptShell {
  start(): Promise<void>;
}

export interface PromptShellOptions {
  chat: ChatAdapter;
  input?: Readable;
  output?: Writable;
  reporter: ProgressReporter;
  retrieval: RetrievalService;
}

const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createAssistantPromptShell = (options: PromptShellOptions): PromptShell => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reporter = options.reporter;
  const history: ChatMessage[] = [];

  return {
    async start() {
      const rl = createInterface({
        input,
        output,
        terminal: false
      });

      try {
        reporter.info("Eberron Query Assistant prompt ready. Type exit or quit to end.");

        while (true) {
          const inputText = await rl.question("> ");
          const question = inputText.trim();
          const command = question.toLowerCase();

          if (command === "exit" || command === "quit") {
            break;
          }

          if (question.length > 0) {
            try {
              const evidence = await options.retrieval.search({
                query: question,
                limit: MAX_EVIDENCE_RESULTS
              });
              const messages = buildAssistantMessages({
                evidence,
                history,
                question
              });
              const response = await options.chat.complete(messages);
              output.write(`${response}\n`);
              history.push({ role: "user", content: question }, { role: "assistant", content: response });
              history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));
            } catch (error) {
              reporter.warn(`Assistant response failed: ${formatThrownValue(error)}`);
            }
          }
        }
      } catch (error) {
        if (!isAbortError(error) && !isReadlineClosedError(error)) {
          throw error;
        }
      } finally {
        rl.close();
        reporter.info("Prompt closed.");
      }
    }
  };
};

export interface AssistantMessageBuildRequest {
  evidence: RetrievalResult[];
  history?: ChatMessage[];
  question: string;
}

export const buildAssistantMessages = (request: AssistantMessageBuildRequest): ChatMessage[] => {
  const evidence = formatEvidence(request.evidence);
  const recentHistory = request.history ?? [];

  return [
    {
      role: "system",
      content: [
        "You are Eberron Query Assistant, a terminal-only assistant for Eberron lore and campaign notes.",
        "Answer using the retrieved evidence when it is relevant.",
        "Distinguish direct support from inference. Do not describe synthesized conclusions as quoted facts.",
        "Include concise references when evidence is available.",
        "Use PDF title plus page when present, article title plus URL, and foundry entity name plus type or identifier."
      ].join("\n")
    },
    ...recentHistory,
    {
      role: "user",
      content: [
        "Retrieved evidence:",
        evidence,
        "",
        `Question: ${request.question}`
      ].join("\n")
    }
  ];
};

export const formatCitation = (result: RetrievalResult): string => {
  const locator = result.citation.locator ? `, ${result.citation.locator}` : "";
  const url = result.citation.url ? `, ${result.citation.url}` : "";
  return `${result.citation.label}${locator}${url} [${result.sourceType}:${result.sourceKey}]`;
};

const formatEvidence = (results: RetrievalResult[]): string => {
  if (results.length === 0) {
    return "No relevant retrieval results were found. Say when the answer is not supported by the local corpus.";
  }

  return results
    .map((result, index) =>
      [
        `[${index + 1}] ${formatCitation(result)}`,
        `Match: ${result.matchKind}, score=${result.score.toFixed(3)}`,
        result.content
      ].join("\n")
    )
    .join("\n\n");
};

const isAbortError = (error: unknown): boolean => {
  return hasErrorName(error, "AbortError");
};

const isReadlineClosedError = (error: unknown): boolean => {
  return error instanceof Error && error.message === "readline was closed";
};
