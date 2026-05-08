import type {
  ChatAdapter,
  ChatCompletionDiagnostic,
  ChatMessage
} from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import { createNoopTimingReporter, type TimingContext } from "../../timing.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from "../../types.js";
import {
  buildAssistantMessages,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from "./assistant-prompts.js";
import { createSqlitePartyContextService, type PartyContextService } from "./party-context.js";
import {
  buildRetrievalToolInstructions,
  clampRetrievalTurnLimit,
  completeStructured,
  RETRIEVAL_TOOL,
  runRetrievalToolLoop
} from "./retrieval-tool.js";
import type { SessionLogExchange, SessionLogProgress } from "./session-log.js";

export interface AssistantSession {
  ask(question: string, options?: AssistantAskOptions): Promise<AssistantSessionAnswer>;
}

export interface AssistantSessionAnswer {
  answer: string;
  evidence: RetrievalResult[];
}

export interface AssistantAskOptions {
  includePartyContext?: boolean;
  onProviderDiagnostic?: (diagnostic: ChatCompletionDiagnostic) => void;
  retrievalTurnLimit?: number;
  timing?: TimingContext;
}

export interface AssistantSessionLogExchange extends Omit<SessionLogExchange, "kind"> {
  sessionTitle: string;
}

export interface AssistantSessionOptions {
  assistant: AssistantConfig;
  appendProgress(entry: SessionLogProgress): Promise<void>;
  chat: ChatAdapter;
  appendExchange(exchange: AssistantSessionLogExchange): Promise<void>;
  config: RuntimeConfig;
  partyContext?: PartyContextService;
  reportStatus?(message: string): Promise<void> | void;
  retrieval: RetrievalService;
}

const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createAssistantSession = (options: AssistantSessionOptions): AssistantSession => {
  const history: ChatMessage[] = [];
  const partyContext = options.partyContext ?? createSqlitePartyContextService();
  let promptAssets: AssistantPromptAssets | null = null;
  let shouldRequestSessionTitle = true;

  const loadPromptAssets = async (): Promise<AssistantPromptAssets> => {
    promptAssets = await loadAssistantPromptAssets(options.assistant);
    return promptAssets;
  };

  return {
    async ask(question, askOptions = {}) {
      const normalizedQuestion = question.trim();
      if (normalizedQuestion.length === 0) {
        throw new Error("Assistant prompt cannot be empty.");
      }

      const includePartyContext = askOptions.includePartyContext ?? true;
      const retrievalTurnLimit = clampRetrievalTurnLimit(askOptions.retrievalTurnLimit ?? 1);
      const timing = askOptions.timing ?? {
        operation: "assistant",
        operationId: "untracked",
        reporter: createNoopTimingReporter()
      };
      const evidence = await timing.reporter.time(timing, "assistant.retrieval.search", () =>
        options.retrieval.search({
          query: normalizedQuestion,
          timing,
          limit: MAX_EVIDENCE_RESULTS
        })
      );
      const partyContextText = includePartyContext
        ? await timing.reporter.time(timing, "assistant.party_context", () => partyContext.build(options.config))
        : "";
      const promptAssets = await timing.reporter.time(timing, "assistant.prompt_assets", () => loadPromptAssets());
      const messages = buildAssistantMessages({
        evidence,
        history,
        includePartyContext,
        partyContext: partyContextText,
        promptAssets,
        question: normalizedQuestion,
        retrievalToolInstructions: buildRetrievalToolInstructions(retrievalTurnLimit),
        requestSessionTitle: shouldRequestSessionTitle
      });
      const response = await timing.reporter.time(timing, "assistant.chat.complete", () => completeStructured(options.chat, messages, {
        debug: {
          operation: timing.operation,
          operationId: timing.operationId,
          purpose: "assistant"
        },
        onDiagnostic: askOptions.onProviderDiagnostic,
        ...(retrievalTurnLimit > 0 ? { tools: [RETRIEVAL_TOOL] } : {})
      }));
      const completion = await runRetrievalToolLoop({
        chat: options.chat,
        initialMessages: messages,
        initialResponse: response,
        onProviderDiagnostic: askOptions.onProviderDiagnostic,
        purpose: "assistant",
        ...(options.reportStatus ? { reportStatus: (message: string) => options.reportStatus?.(message) } : {}),
        retrieval: options.retrieval,
        retrievalTurnLimit,
        timing,
        writeProgress: async (entry) =>
          requestProgressAppend((progressEntry) => options.appendProgress(progressEntry), timing, entry.message)
      });
      const parsedResponse = parseAssistantResponse(completion.responseText, shouldRequestSessionTitle) ??
        await timing.reporter.time(timing, "assistant.chat.repair_metadata", async () => {
          const repairedResponse = await options.chat.complete([
            ...completion.messages,
            { role: "assistant", content: completion.responseText },
            { role: "user", content: buildMetadataRepairPrompt(shouldRequestSessionTitle) }
          ], {
            debug: {
              operation: timing.operation,
              operationId: timing.operationId,
              purpose: "assistant-metadata-repair"
            },
            onDiagnostic: askOptions.onProviderDiagnostic
          });
          return parseAssistantResponse(repairedResponse, shouldRequestSessionTitle);
        });
      if (!parsedResponse) {
        throw new Error("Assistant response did not include required title metadata.");
      }
      const answer = parsedResponse.answer;
      shouldRequestSessionTitle = false;

      await timing.reporter.time(timing, "assistant.log.append_exchange", () => options.appendExchange({
        assistant: answer,
        sessionTitle: parsedResponse.sessionTitle,
        title: parsedResponse.responseTitle,
        user: normalizedQuestion
      }));
      history.push({ role: "user", content: normalizedQuestion }, { role: "assistant", content: answer });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));

      return {
        answer,
        evidence
      };
    }
  };
};

interface ParsedAssistantResponse {
  answer: string;
  responseTitle: string;
  sessionTitle: string;
}

const parseAssistantResponse = (response: string, expectSessionTitle: boolean): ParsedAssistantResponse | null => {
  const sessionTitle = readTag(response, "session-title");
  const responseTitle = readTag(response, "response-title");
  const answer = readTag(response, "answer");

  if (!responseTitle || !answer) {
    return null;
  }

  return {
    answer,
    responseTitle,
    sessionTitle: expectSessionTitle ? (sessionTitle ?? responseTitle) : responseTitle
  };
};

const readTag = (text: string, tagName: string): string | null => {
  const match = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i").exec(text);
  const content = match?.[1]?.trim();
  return content && content.length > 0 ? content : null;
};

const buildMetadataRepairPrompt = (requestSessionTitle: boolean): string => [
  "Your previous response was missing required title metadata.",
  "Return the same answer content again, but wrap it exactly in the required XML-like metadata tags.",
  requestSessionTitle
    ? "Include <session-title>, <response-title>, and <answer>."
    : "Include <response-title> and <answer>. Do not include <session-title>.",
  "Do not add commentary outside the tags."
].join("\n");

const requestProgressAppend = async (
  appendProgress: AssistantSessionOptions["appendProgress"],
  timing: TimingContext,
  message: string
): Promise<void> => {
  await timing.reporter.time(timing, "assistant.log.append_progress", () =>
    appendProgress({
      kind: "progress",
      message
    })
  );
};
