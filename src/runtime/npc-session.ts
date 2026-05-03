import type { ChatAdapter, ChatMessage } from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from "../types.js";
import { readGeneratedNpcState, updateGeneratedNpcState } from "./npc-store.js";
import { formatCitation, loadAssistantPromptAssets, type AssistantPromptAssets } from "./prompt.js";

export interface GeneratedNpc {
  age?: string;
  bio: string;
  description: string;
  ethnicity?: string;
  gender?: string;
  id: number;
  name: string;
  role?: string;
  species?: string;
}

export interface NpcGenerationSession {
  generate(prompt: string): Promise<NpcGenerationAnswer>;
  read(): Promise<GeneratedNpc[]>;
  reset(): void;
}

export interface NpcGenerationAnswer {
  evidence: RetrievalResult[];
  npcs: GeneratedNpc[];
}

export interface NpcGenerationSessionOptions {
  assistant: AssistantConfig;
  chat: ChatAdapter;
  config: RuntimeConfig;
  retrieval: RetrievalService;
}

const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createNpcGenerationSession = (options: NpcGenerationSessionOptions): NpcGenerationSession => {
  const history: ChatMessage[] = [];
  let promptAssets: AssistantPromptAssets | null = null;

  const loadPromptAssets = async (): Promise<AssistantPromptAssets> => {
    promptAssets ??= await loadAssistantPromptAssets(options.assistant);
    return promptAssets;
  };

  return {
    async generate(prompt) {
      const normalizedPrompt = prompt.trim();
      if (normalizedPrompt.length === 0) {
        throw new Error("NPC generation prompt cannot be empty.");
      }

      const evidence = await options.retrieval.search({
        query: normalizedPrompt,
        limit: MAX_EVIDENCE_RESULTS
      });
      const existingNpcs = await readGeneratedNpcState(options.config);
      const maxExistingId = readMaxNpcId(existingNpcs);
      const messages = buildNpcGenerationMessages({
        evidence,
        history,
        maxExistingId,
        npcs: existingNpcs,
        prompt: normalizedPrompt,
        promptAssets: await loadPromptAssets()
      });
      const response = await options.chat.complete(messages);
      const returnedNpcs = parseNpcGenerationResponse(response, existingNpcs);
      const savedNpcs = await updateGeneratedNpcState(options.config, returnedNpcs);

      const structuredResponse = JSON.stringify({ npcs: returnedNpcs });
      history.push({ role: "user", content: normalizedPrompt }, { role: "assistant", content: structuredResponse });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));

      return {
        evidence,
        npcs: readNpcList(savedNpcs)
      };
    },
    async read() {
      return readNpcList(await readGeneratedNpcState(options.config));
    },
    reset() {
      history.splice(0, history.length);
    }
  };
};

interface NpcMessageBuildRequest {
  evidence: RetrievalResult[];
  history: ChatMessage[];
  maxExistingId: number;
  npcs: GeneratedNpc[];
  prompt: string;
  promptAssets: AssistantPromptAssets;
}

export const buildNpcGenerationMessages = (request: NpcMessageBuildRequest): ChatMessage[] => {
  const systemPromptParts = [
    request.promptAssets.systemPrompt,
    request.promptAssets.additionalContext.length > 0
      ? ["Additional assistant context:", request.promptAssets.additionalContext].join("\n")
      : "",
    request.promptAssets.npcGeneratorPrompt.replaceAll("{{maxExistingId}}", String(request.maxExistingId))
  ].filter((part) => part.length > 0);

  return [
    {
      role: "system",
      content: systemPromptParts.join("\n\n")
    },
    ...request.history,
    {
      role: "user",
      content: [
        "Retrieved evidence:",
        formatEvidenceForNpcPrompt(request.evidence),
        "",
        "Saved NPCs:",
        request.npcs.length > 0 ? JSON.stringify({ npcs: request.npcs }) : "[]",
        "",
        `Prompt: ${request.prompt}`
      ].join("\n")
    }
  ];
};

export const parseNpcGenerationResponse = (response: string, existingNpcs: GeneratedNpc[]): GeneratedNpc[] => {
  const parsed = JSON.parse(stripJsonCodeFence(response)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.npcs)) {
    throw new Error("NPC generation response must be JSON with an npcs array.");
  }

  const npcs = parsed.npcs.map(readGeneratedNpc);
  const maxExistingId = readMaxNpcId(existingNpcs);
  const existingIds = new Set(existingNpcs.map((npc) => npc.id));
  if (new Set(npcs.map((npc) => npc.id)).size !== npcs.length) {
    throw new Error("NPC generation response included duplicate ids.");
  }
  if (npcs.some((npc) => npc.id <= maxExistingId && !existingIds.has(npc.id))) {
    throw new Error("NPC generation response assigned a new NPC id below the current maximum id.");
  }

  return npcs;
};

const readGeneratedNpc = (value: unknown): GeneratedNpc => {
  const id = isRecord(value) ? value.id : null;
  if (
    !isRecord(value) ||
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id <= 0 ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.bio !== "string"
  ) {
    throw new Error("NPC generation response included an invalid NPC record.");
  }

  const npc = {
    id,
    name: value.name.trim(),
    ...readOptionalNpcDetails(value),
    description: value.description.trim(),
    bio: value.bio.trim()
  };
  if (npc.name.length === 0 || npc.description.length === 0 || npc.bio.length === 0) {
    throw new Error("NPC generation response included an empty NPC field.");
  }

  return npc;
};

const formatEvidenceForNpcPrompt = (results: RetrievalResult[]): string => {
  if (results.length === 0) {
    return "No relevant retrieval results were found. Use general Eberron lore only when it is reasonable.";
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

const readNpcList = (npcs: GeneratedNpc[]): GeneratedNpc[] =>
  npcs.map((npc) => ({
    ...readOptionalNpcDetails(npc),
    bio: npc.bio,
    description: npc.description,
    id: npc.id,
    name: npc.name
  }));

const OPTIONAL_NPC_DETAIL_KEYS = ["species", "ethnicity", "gender", "role", "age"] as const;
type OptionalNpcDetailKey = (typeof OPTIONAL_NPC_DETAIL_KEYS)[number];

const readOptionalNpcDetails = (value: Partial<Record<OptionalNpcDetailKey, unknown>>): Partial<GeneratedNpc> => {
  const details: Partial<GeneratedNpc> = {};

  for (const key of OPTIONAL_NPC_DETAIL_KEYS) {
    const detail = value[key];
    if (detail === undefined) {
      continue;
    }
    if (typeof detail !== "string") {
      throw new Error("NPC generation response included an invalid NPC record.");
    }

    const normalized = detail.trim();
    if (normalized.length > 0) {
      details[key] = normalized;
    }
  }

  return details;
};

const readMaxNpcId = (npcs: GeneratedNpc[]): number => npcs.reduce((maxId, npc) => Math.max(maxId, npc.id), 0);

const stripJsonCodeFence = (response: string): string => {
  const trimmed = response.trim();
  const match = trimmed.match(/^```(?:json)?\s*(?<json>[\s\S]*?)\s*```$/i);
  return match?.groups?.json?.trim() ?? trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
