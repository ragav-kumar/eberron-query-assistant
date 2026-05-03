import type { ChatAdapter, ChatMessage } from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from "../types.js";
import {
  buildAssistantMessages,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from "./prompt.js";
import { createSqlitePartyContextService, type PartyContextService } from "./party-context.js";
import type { SessionLogExchange } from "./session-log.js";

export interface AssistantSession {
  ask(question: string): Promise<AssistantSessionAnswer>;
}

export interface AssistantSessionAnswer {
  answer: string;
  evidence: RetrievalResult[];
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
    async ask(question) {
      const normalizedQuestion = question.trim();
      if (normalizedQuestion.length === 0) {
        throw new Error("Assistant prompt cannot be empty.");
      }

      const evidence = await options.retrieval.search({
        query: normalizedQuestion,
        limit: MAX_EVIDENCE_RESULTS
      });
      const response = await options.chat.complete(
        buildAssistantMessages({
          evidence,
          history,
          partyContext: await partyContext.build(options.config),
          promptAssets: await loadPromptAssets(),
          question: normalizedQuestion,
          requestSessionTitle: shouldRequestSessionTitle
        })
      );
      const parsedResponse = parseAssistantResponse(response, shouldRequestSessionTitle);
      const answer = parsedResponse?.answer ?? response.trim();
      shouldRequestSessionTitle = false;

      await options.appendExchange({
        assistant: answer,
        sessionTitle: parsedResponse?.sessionTitle ?? normalizedQuestion,
        title: parsedResponse?.responseTitle ?? normalizedQuestion,
        user: normalizedQuestion
      });
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
  sessionTitle?: string;
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
