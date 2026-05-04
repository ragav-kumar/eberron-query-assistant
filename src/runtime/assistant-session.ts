import type { ChatAdapter, ChatCompletionDiagnostic, ChatMessage } from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import { createNoopTimingReporter, type TimingContext } from "../timing.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from "../types.js";
import {
  buildAssistantMessages,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from "./prompt.js";
import { createSqlitePartyContextService, type PartyContextService } from "./party-context.js";
import type { SessionLogExchange } from "./session-log.js";

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
  timing?: TimingContext;
}

export interface AssistantSessionLogExchange extends SessionLogExchange {
  sessionTitle: string;
}

export interface AssistantSessionOptions {
  assistant: AssistantConfig;
  chat: ChatAdapter;
  appendExchange(exchange: AssistantSessionLogExchange): Promise<void>;
  config: RuntimeConfig;
  partyContext?: PartyContextService;
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
        requestSessionTitle: shouldRequestSessionTitle
      });
      const response = await timing.reporter.time(timing, "assistant.chat.complete", () => options.chat.complete(messages, {
        debug: {
          operation: timing.operation,
          operationId: timing.operationId,
          purpose: "assistant"
        },
        onDiagnostic: askOptions.onProviderDiagnostic
      }));
      const parsedResponse = parseAssistantResponse(response, shouldRequestSessionTitle) ??
        await timing.reporter.time(timing, "assistant.chat.repair_metadata", async () => {
          const repairedResponse = await options.chat.complete([
            ...messages,
            { role: "assistant", content: response },
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
