import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import type { Readable, Writable } from "node:stream";

import { createTaggedError, formatThrownValue, hasErrorCode, hasErrorName } from "../errors.js";
import type { ChatAdapter, ChatMessage } from "../provider/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from "../types.js";
import { createSqlitePartyContextService, type PartyContextService } from "./party-context.js";
import { createSessionLog, type SessionLog } from "./session-log.js";

export interface PromptShell {
  start(): Promise<void>;
}

export interface PromptShellOptions {
  assistant: AssistantConfig;
  chat: ChatAdapter;
  config: RuntimeConfig;
  input?: Readable;
  logDir?: string;
  output?: Writable;
  partyContext?: PartyContextService;
  reporter: ProgressReporter;
  retrieval: RetrievalService;
}

const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createAssistantPromptShell = (options: PromptShellOptions): PromptShell => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const partyContext = options.partyContext ?? createSqlitePartyContextService();
  const reporter = options.reporter;
  const history: ChatMessage[] = [];
  let sessionLog: SessionLog | null = null;

  return {
    async start() {
      const promptAssets = await loadAssistantPromptAssets(options.assistant);
      const rl = createInterface({
        input,
        output,
        terminal: isTty(input) && isTty(output)
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
              const shouldRequestSessionTitle = options.logDir !== undefined && sessionLog === null;
              const messages = buildAssistantMessages({
                evidence,
                history,
                partyContext: await partyContext.build(options.config),
                promptAssets,
                question,
                requestSessionTitle: shouldRequestSessionTitle
              });
              const response = await options.chat.complete(messages);
              const parsedResponse = parseAssistantResponse(response, shouldRequestSessionTitle);
              const assistantResponse = parsedResponse?.answer ?? response;
              output.write(formatAssistantResponse(assistantResponse));
              await appendSessionExchange({
                assistantResponse,
                fallbackTitle: question,
                logDir: options.logDir,
                parsedResponseTitle: parsedResponse?.responseTitle,
                parsedSessionTitle: parsedResponse?.sessionTitle,
                reporter,
                sessionLog,
                setSessionLog(value) {
                  sessionLog = value;
                },
                userQuestion: question
              });
              history.push({ role: "user", content: question }, { role: "assistant", content: assistantResponse });
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

const formatAssistantResponse = (response: string): string => {
  return `\n${response.trimEnd()}\n\n`;
};

export interface AssistantMessageBuildRequest {
  evidence: RetrievalResult[];
  history?: ChatMessage[];
  partyContext?: string;
  promptAssets: AssistantPromptAssets;
  question: string;
  requestSessionTitle?: boolean;
}

export interface AssistantPromptAssets {
  additionalContext: string;
  npcGeneratorPrompt: string;
  sessionTitlePrompt: string;
  systemPrompt: string;
}

export const buildAssistantMessages = (request: AssistantMessageBuildRequest): ChatMessage[] => {
  const evidence = formatEvidence(request.evidence);
  const recentHistory = request.history ?? [];
  const partyContext = request.partyContext?.trim() ?? "";
  const userContentParts = [
    partyContext,
    partyContext.length > 0 ? "" : "",
    "Retrieved evidence:",
    evidence,
    "",
    `Question: ${request.question}`
  ].filter((part, index) => part.length > 0 || (partyContext.length > 0 && index === 1));
  const systemPromptParts = [
    request.promptAssets.systemPrompt,
    request.promptAssets.additionalContext.length > 0
      ? ["Additional assistant context:", request.promptAssets.additionalContext].join("\n")
      : "",
    request.promptAssets.sessionTitlePrompt,
    request.requestSessionTitle === true
      ? "This response starts a new transcript session; include <session-title>."
      : "This response continues an existing transcript session; omit <session-title>."
  ].filter((part) => part.length > 0);

  return [
    {
      role: "system",
      content: systemPromptParts.join("\n\n")
    },
    ...recentHistory,
    {
      role: "user",
      content: userContentParts.join("\n")
    }
  ];
};

export const loadAssistantPromptAssets = async (config: AssistantConfig): Promise<AssistantPromptAssets> => {
  await ensureAdditionalContextFile(config);

  const [systemPrompt, sessionTitlePrompt, npcGeneratorPrompt, additionalContext] = await Promise.all([
    readRequiredPromptFile(config.systemPromptPath, "system prompt"),
    readRequiredPromptFile(config.sessionTitlePromptPath, "session title prompt"),
    readRequiredPromptFile(config.npcGeneratorPromptPath, "NPC generator prompt"),
    readFile(config.additionalContextPath, "utf8")
  ]);

  return {
    additionalContext: additionalContext.trim(),
    npcGeneratorPrompt: npcGeneratorPrompt.trim(),
    sessionTitlePrompt: sessionTitlePrompt.trim(),
    systemPrompt: systemPrompt.trim()
  };
};

const ensureAdditionalContextFile = async (config: AssistantConfig): Promise<void> => {
  await mkdir(config.assistantDir, { recursive: true });

  try {
    await readFile(config.additionalContextPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      await writeFile(config.additionalContextPath, "", "utf8");
      return;
    }
    throw error;
  }
};

const readRequiredPromptFile = async (filePath: string, label: string): Promise<string> => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw createTaggedError("assistant-prompt-missing", `Missing ${label} file: ${filePath}`);
    }
    throw error;
  }
};

interface ParsedAssistantResponse {
  answer: string;
  responseTitle: string;
  sessionTitle?: string;
}

interface AppendSessionExchangeRequest {
  assistantResponse: string;
  fallbackTitle: string;
  logDir: string | undefined;
  parsedResponseTitle: string | undefined;
  parsedSessionTitle: string | undefined;
  reporter: ProgressReporter;
  sessionLog: SessionLog | null;
  setSessionLog(sessionLog: SessionLog): void;
  userQuestion: string;
}

const parseAssistantResponse = (response: string, expectSessionTitle: boolean): ParsedAssistantResponse | null => {
  const match = expectSessionTitle
    ? response.match(
        /^\s*<session-title>(?<sessionTitle>[\s\S]*?)<\/session-title>\s*<response-title>(?<responseTitle>[\s\S]*?)<\/response-title>\s*<answer>\s*(?<answer>[\s\S]*?)\s*<\/answer>\s*$/i
      )
    : response.match(
        /^\s*<response-title>(?<responseTitle>[\s\S]*?)<\/response-title>\s*<answer>\s*(?<answer>[\s\S]*?)\s*<\/answer>\s*$/i
      );
  const sessionTitle = match?.groups?.sessionTitle?.trim();
  const responseTitle = match?.groups?.responseTitle?.trim();
  const answer = match?.groups?.answer?.trim();

  if ((expectSessionTitle && !sessionTitle) || !responseTitle || !answer) {
    return null;
  }

  return {
    answer,
    responseTitle,
    ...(sessionTitle ? { sessionTitle } : {})
  };
};

const appendSessionExchange = async (request: AppendSessionExchangeRequest): Promise<void> => {
  if (!request.logDir) {
    return;
  }

  try {
    const sessionLog =
      request.sessionLog ??
      (await createSessionLog({
        logDir: request.logDir,
        title: request.parsedSessionTitle ?? request.fallbackTitle
      }));
    if (request.sessionLog === null) {
      request.setSessionLog(sessionLog);
    }
    await sessionLog.append({
      assistant: request.assistantResponse,
      title: request.parsedResponseTitle ?? request.fallbackTitle,
      user: request.userQuestion
    });
  } catch (error) {
    request.reporter.warn(`Session log update failed: ${formatThrownValue(error)}`);
  }
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

const isTty = (stream: Readable | Writable): boolean => {
  return "isTTY" in stream && stream.isTTY === true;
};
