import type {
  ChatAdapter,
  ChatCompletionOptions,
  ChatCompletionDiagnostic,
  ChatMessage,
  ChatStructuredResult,
  ChatToolCall,
  ChatToolDefinition
} from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import { createNoopTimingReporter, type TimingContext } from "../timing.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig, SourceType } from "../types.js";
import {
  buildAssistantMessages,
  formatEvidence,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from "./assistant-prompts.js";
import { createSqlitePartyContextService, type PartyContextService } from "./party-context.js";
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
const MAX_RETRIEVAL_TOOL_TURNS = 3;
const SEARCH_CORPUS_TOOL_NAME = "search_corpus";
const RETRIEVAL_TOOL: ChatToolDefinition = {
  description: "Search the local Eberron corpus for targeted supporting evidence.",
  name: SEARCH_CORPUS_TOOL_NAME,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string"
      },
      sourceTypes: {
        type: "array",
        items: {
          type: "string",
          enum: ["foundry", "pdf", "article"]
        }
      },
      sourceKeys: {
        type: "array",
        items: {
          type: "string"
        }
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_EVIDENCE_RESULTS
      },
      userMessage: {
        type: "string"
      }
    },
    required: ["query", "userMessage"]
  }
};

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
        appendProgress: options.appendProgress,
        chat: options.chat,
        initialMessages: messages,
        initialResponse: response,
        onProviderDiagnostic: askOptions.onProviderDiagnostic,
        reportStatus: options.reportStatus,
        remainingTurns: retrievalTurnLimit,
        retrieval: options.retrieval,
        shouldRequestSessionTitle,
        timing
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

interface RetrievalToolLoopRequest {
  appendProgress: AssistantSessionOptions["appendProgress"];
  chat: ChatAdapter;
  initialMessages: ChatMessage[];
  initialResponse: ChatStructuredResult;
  onProviderDiagnostic: ((diagnostic: ChatCompletionDiagnostic) => void) | undefined;
  reportStatus: AssistantSessionOptions["reportStatus"];
  remainingTurns: number;
  retrieval: RetrievalService;
  shouldRequestSessionTitle: boolean;
  timing: TimingContext;
}

interface RetrievalToolLoopResult {
  messages: ChatMessage[];
  responseText: string;
}

interface SearchCorpusArgs {
  limit: number;
  query: string;
  sourceKeys?: string[];
  sourceTypes?: SourceType[];
  userMessage: string;
}

const runRetrievalToolLoop = async (request: RetrievalToolLoopRequest): Promise<RetrievalToolLoopResult> => {
  const messages = [...request.initialMessages];
  let response = request.initialResponse;
  let remainingTurns = request.remainingTurns;

  while (response.kind === "tool-calls") {
    messages.push({
      content: response.content,
      role: "assistant",
      toolCalls: response.toolCalls
    });

    for (const toolCall of response.toolCalls) {
      const toolResult = await executeToolCall({
        appendProgress: request.appendProgress,
        remainingTurns,
        reportStatus: request.reportStatus,
        retrieval: request.retrieval,
        timing: request.timing,
        totalTurns: request.remainingTurns,
        toolCall
      });
      if (toolResult.consumeTurn) {
        remainingTurns -= 1;
      }
      messages.push({
        content: toolResult.content,
        name: toolCall.name,
        role: "tool",
        toolCallId: toolCall.id
      });
    }

    response = await request.timing.reporter.time(request.timing, "assistant.chat.complete", () => completeStructured(
      request.chat,
      messages,
      {
        debug: {
          operation: request.timing.operation,
          operationId: request.timing.operationId,
          purpose: "assistant"
        },
        onDiagnostic: request.onProviderDiagnostic,
        ...(remainingTurns > 0 ? { tools: [RETRIEVAL_TOOL] } : {})
      }
    ));
  }

  return {
    messages,
    responseText: response.content
  };
};

const executeToolCall = async (
  request: {
    appendProgress: AssistantSessionOptions["appendProgress"];
    remainingTurns: number;
    reportStatus: AssistantSessionOptions["reportStatus"];
    retrieval: RetrievalService;
    timing: TimingContext;
    totalTurns: number;
    toolCall: ChatToolCall;
  }
): Promise<{ consumeTurn: boolean; content: string }> => {
  if (request.toolCall.name !== SEARCH_CORPUS_TOOL_NAME) {
    return {
      consumeTurn: false,
      content: `Tool error: unsupported tool "${request.toolCall.name}". Use ${SEARCH_CORPUS_TOOL_NAME} for local retrieval.`
    };
  }

  if (request.remainingTurns <= 0) {
    return {
      consumeTurn: false,
      content: "No more retrieval turns are available for this answer. Produce the final response from the evidence already provided."
    };
  }

  const parsedArgs = readSearchCorpusArgs(request.toolCall.arguments);
  if (!parsedArgs.ok) {
    return {
      consumeTurn: false,
      content: `Tool error: ${parsedArgs.message}`
    };
  }

  const turnNumber = request.totalTurns - request.remainingTurns + 1;
  await request.reportStatus?.(
    `Assistant called ${SEARCH_CORPUS_TOOL_NAME} (turn ${turnNumber}/${request.totalTurns}): ${parsedArgs.value.userMessage}`
  );
  await request.timing.reporter.time(request.timing, "assistant.log.append_progress", () => request.appendProgress({
    kind: "progress",
    message: parsedArgs.value.userMessage
  }));
  const results = await request.timing.reporter.time(request.timing, "assistant.retrieval.search", () => request.retrieval.search({
    query: parsedArgs.value.query,
    ...(parsedArgs.value.sourceKeys ? { sourceKeys: parsedArgs.value.sourceKeys } : {}),
    ...(parsedArgs.value.sourceTypes ? { sourceTypes: parsedArgs.value.sourceTypes } : {}),
    timing: request.timing,
    limit: parsedArgs.value.limit
  }));

  return {
    consumeTurn: true,
    content: [
      `Search progress: ${parsedArgs.value.userMessage}`,
      "",
      "Retrieved evidence:",
      formatEvidence(results)
    ].join("\n")
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

const buildRetrievalToolInstructions = (retrievalTurnLimit: number): string => retrievalTurnLimit > 0
  ? [
    `You may call the ${SEARCH_CORPUS_TOOL_NAME} tool when the initial evidence is not enough.`,
    "Use it only for targeted follow-up retrieval.",
    `You may make at most ${retrievalTurnLimit} additional retrieval request${retrievalTurnLimit === 1 ? "" : "s"}.`,
    "Set userMessage to concise progress text suitable for the transcript log. Do not include hidden reasoning."
  ].join("\n")
  : "No additional retrieval tool calls are available for this response. Answer from the initial evidence only.";

const clampRetrievalTurnLimit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_RETRIEVAL_TOOL_TURNS, Math.max(0, Math.trunc(value)));
};

const readSearchCorpusArgs = (rawArguments: string): { ok: true; value: SearchCorpusArgs } | { message: string; ok: false } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments) as unknown;
  } catch {
    return {
      message: "tool arguments must be valid JSON.",
      ok: false
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      message: "tool arguments must be a JSON object.",
      ok: false
    };
  }

  const record = parsed as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim() : "";
  const userMessage = typeof record.userMessage === "string" ? record.userMessage.trim() : "";
  if (query.length === 0) {
    return {
      message: "query is required.",
      ok: false
    };
  }
  if (userMessage.length === 0) {
    return {
      message: "userMessage is required.",
      ok: false
    };
  }

  const sourceTypes = readSourceTypes(record.sourceTypes);
  if (!sourceTypes.ok) {
    return sourceTypes;
  }
  const sourceKeys = readStringArray(record.sourceKeys, "sourceKeys");
  if (!sourceKeys.ok) {
    return sourceKeys;
  }

  return {
    ok: true,
    value: {
      limit: clampEvidenceLimit(record.limit),
      query,
      ...(sourceKeys.value ? { sourceKeys: sourceKeys.value } : {}),
      ...(sourceTypes.value ? { sourceTypes: sourceTypes.value } : {}),
      userMessage
    }
  };
};

const readSourceTypes = (value: unknown):
{ ok: true; value?: SourceType[] } |
{ message: string; ok: false } => {
  const sourceTypes = readStringArray(value, "sourceTypes");
  if (!sourceTypes.ok) {
    return sourceTypes;
  }
  if (!sourceTypes.value) {
    return { ok: true };
  }
  if (sourceTypes.value.some((sourceType) => !isSourceType(sourceType))) {
    return {
      message: "sourceTypes must contain only foundry, pdf, or article.",
      ok: false
    };
  }
  return {
    ok: true,
    value: sourceTypes.value as SourceType[]
  };
};

const readStringArray = (
  value: unknown,
  field: string
): { ok: true; value?: string[] } | { message: string; ok: false } => {
  if (value === undefined) {
    return { ok: true };
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return {
      message: `${field} must be an array of strings.`,
      ok: false
    };
  }
  const normalized = value.map((item) => item.trim()).filter((item) => item.length > 0);
  return {
    ok: true,
    ...(normalized.length > 0 ? { value: normalized } : {})
  };
};

const clampEvidenceLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_EVIDENCE_RESULTS;
  }

  return Math.min(MAX_EVIDENCE_RESULTS, Math.max(1, Math.trunc(value)));
};

const isSourceType = (value: string): value is SourceType => {
  return value === "foundry" || value === "pdf" || value === "article";
};

const completeStructured = async (
  chat: ChatAdapter,
  messages: ChatMessage[],
  options: ChatCompletionOptions
): Promise<ChatStructuredResult> => {
  if (chat.completeStructured) {
    return chat.completeStructured(messages, options);
  }

  return {
    content: await chat.complete(messages, options),
    kind: "text"
  };
};
