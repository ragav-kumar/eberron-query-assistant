import type {
  ChatAdapter,
  ChatCompletionDiagnostic,
  ChatCompletionOptions,
  ChatMessage,
  ChatStructuredResult,
  ChatToolCall,
  ChatToolDefinition
} from "../provider/index.js";
import { formatEvidence } from "./assistant-prompts.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { TimingContext } from "../timing.js";
import type { SourceType } from "../types.js";

const MAX_EVIDENCE_RESULTS = 8;
const MAX_RETRIEVAL_TOOL_TURNS = 3;
const SEARCH_CORPUS_TOOL_NAME = "search_corpus";

export const RETRIEVAL_TOOL: ChatToolDefinition = {
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

export interface RetrievalToolProgressEntry {
  message: string;
}

export interface RetrievalToolLoopRequest {
  chat: ChatAdapter;
  initialMessages: ChatMessage[];
  initialResponse: ChatStructuredResult;
  onProviderDiagnostic?: ((diagnostic: ChatCompletionDiagnostic) => void) | undefined;
  purpose: string;
  reportStatus?: ((message: string) => Promise<void> | void) | undefined;
  retrieval: RetrievalService;
  retrievalTurnLimit: number;
  timing: TimingContext;
  writeProgress?: ((entry: RetrievalToolProgressEntry) => Promise<void>) | undefined;
}

interface SearchCorpusArgs {
  limit: number;
  query: string;
  sourceKeys?: string[];
  sourceTypes?: SourceType[];
  userMessage: string;
}

export const clampRetrievalTurnLimit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(MAX_RETRIEVAL_TOOL_TURNS, Math.max(0, Math.trunc(value)));
};

export const buildRetrievalToolInstructions = (retrievalTurnLimit: number): string => retrievalTurnLimit > 0
  ? [
    `You may call the ${SEARCH_CORPUS_TOOL_NAME} tool when the initial evidence is not enough.`,
    "Use it only for targeted follow-up retrieval.",
    `You may make at most ${retrievalTurnLimit} additional retrieval request${retrievalTurnLimit === 1 ? "" : "s"}.`,
    "Set userMessage to concise progress text suitable for user-visible progress output. Do not include hidden reasoning."
  ].join("\n")
  : "No additional retrieval tool calls are available for this response. Answer from the initial evidence only.";

export const completeStructured = async (
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

export const runRetrievalToolLoop = async (request: RetrievalToolLoopRequest): Promise<{
  messages: ChatMessage[];
  responseText: string;
}> => {
  const messages = [...request.initialMessages];
  let response = request.initialResponse;
  let remainingTurns = request.retrievalTurnLimit;

  while (response.kind === "tool-calls") {
    messages.push({
      content: response.content,
      role: "assistant",
      toolCalls: response.toolCalls
    });

    for (const toolCall of response.toolCalls) {
      const toolResult = await executeToolCall({
        remainingTurns,
        reportStatus: request.reportStatus,
        retrieval: request.retrieval,
        timing: request.timing,
        totalTurns: request.retrievalTurnLimit,
        toolCall,
        writeProgress: request.writeProgress
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

    response = await request.timing.reporter.time(
      request.timing,
      `${request.purpose}.chat.complete`,
      () =>
        completeStructured(request.chat, messages, {
          debug: {
            operation: request.timing.operation,
            operationId: request.timing.operationId,
            purpose: request.purpose
          },
          onDiagnostic: request.onProviderDiagnostic,
          ...(remainingTurns > 0 ? { tools: [RETRIEVAL_TOOL] } : {})
        })
    );
  }

  return {
    messages,
    responseText: response.content
  };
};

const executeToolCall = async (
  request: {
    remainingTurns: number;
    reportStatus?: ((message: string) => Promise<void> | void) | undefined;
    retrieval: RetrievalService;
    timing: TimingContext;
    totalTurns: number;
    toolCall: ChatToolCall;
    writeProgress?: ((entry: RetrievalToolProgressEntry) => Promise<void>) | undefined;
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
  const statusMessage =
    `Assistant called ${SEARCH_CORPUS_TOOL_NAME} (turn ${turnNumber}/${request.totalTurns}): ${parsedArgs.value.userMessage}`;
  await request.reportStatus?.(statusMessage);
  await request.writeProgress?.({
    message: parsedArgs.value.userMessage
  });
  const results = await request.timing.reporter.time(request.timing, `${request.timing.operation}.retrieval.search`, () =>
    request.retrieval.search({
      query: parsedArgs.value.query,
      ...(parsedArgs.value.sourceKeys ? { sourceKeys: parsedArgs.value.sourceKeys } : {}),
      ...(parsedArgs.value.sourceTypes ? { sourceTypes: parsedArgs.value.sourceTypes } : {}),
      timing: request.timing,
      limit: parsedArgs.value.limit
    })
  );

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

const readSourceTypes = (
  value: unknown
): { ok: true; value?: SourceType[] } | { message: string; ok: false } => {
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
  const normalized = (value as string[]).map((item) => item.trim()).filter((item) => item.length > 0);
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
