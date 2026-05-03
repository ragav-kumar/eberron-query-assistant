import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatAdapter, ChatMessage } from "../provider/index.js";
import type { RetrievalService } from "../retrieval/index.js";
import type { AssistantConfig, RetrievalResult } from "../types.js";
import { formatCitation, loadAssistantPromptAssets, type AssistantPromptAssets } from "./prompt.js";

export interface GeneratedNpc {
  bio: string;
  description: string;
  id: number;
  name: string;
}

export interface NpcGenerationSession {
  generate(prompt: string): Promise<NpcGenerationAnswer>;
  read(): GeneratedNpc[];
  reset(): void;
}

export interface NpcGenerationAnswer {
  evidence: RetrievalResult[];
  npcs: GeneratedNpc[];
}

export interface NpcGenerationSessionOptions {
  assistant: AssistantConfig;
  chat: ChatAdapter;
  logDir: string;
  retrieval: RetrievalService;
}

const GENERATED_NPCS_LOG_FILE = "generated_npcs.md";
const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createNpcGenerationSession = (options: NpcGenerationSessionOptions): NpcGenerationSession => {
  const history: ChatMessage[] = [];
  let npcs: GeneratedNpc[] = [];
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
      const maxExistingId = readMaxNpcId(npcs);
      const messages = buildNpcGenerationMessages({
        evidence,
        history,
        maxExistingId,
        npcs,
        prompt: normalizedPrompt,
        promptAssets: await loadPromptAssets()
      });
      const response = await options.chat.complete(messages);
      const returnedNpcs = parseNpcGenerationResponse(response, npcs);
      npcs = mergeNpcsById(npcs, returnedNpcs);
      await appendGeneratedNpcsLog({
        logDir: options.logDir,
        npcs: returnedNpcs,
        prompt: normalizedPrompt
      });

      const structuredResponse = JSON.stringify({ npcs: returnedNpcs });
      history.push({ role: "user", content: normalizedPrompt }, { role: "assistant", content: structuredResponse });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));

      return {
        evidence,
        npcs: readNpcList(npcs)
      };
    },
    read() {
      return readNpcList(npcs);
    },
    reset() {
      history.splice(0, history.length);
      npcs = [];
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
    [
      "You are in NPC name generator mode.",
      "Generate Eberron-appropriate NPC records based on the user prompt and retrieved evidence.",
      "Infer how many NPCs the user wants from the prompt.",
      "Return only strict JSON with this exact shape: {\"npcs\":[{\"id\":number,\"name\":\"...\",\"description\":\"...\",\"bio\":\"...\"}]}",
      "Each description must be a concise physical description.",
      "Each bio must be very short.",
      "Use existing NPC ids only when revising an NPC already present in the current session.",
      `For new NPCs, ids must be greater than ${request.maxExistingId}.`,
      "Do not include markdown, commentary, citations, or regular assistant prose in the response."
    ].join("\n")
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
        "Current NPCs in this session:",
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
    description: value.description.trim(),
    bio: value.bio.trim()
  };
  if (npc.name.length === 0 || npc.description.length === 0 || npc.bio.length === 0) {
    throw new Error("NPC generation response included an empty NPC field.");
  }

  return npc;
};

const mergeNpcsById = (current: GeneratedNpc[], updates: GeneratedNpc[]): GeneratedNpc[] => {
  const merged = new Map(current.map((npc) => [npc.id, npc]));
  for (const update of updates) {
    merged.set(update.id, update);
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
};

const appendGeneratedNpcsLog = async (request: {
  logDir: string;
  npcs: GeneratedNpc[];
  prompt: string;
}): Promise<void> => {
  await mkdir(request.logDir, { recursive: true });
  const filePath = path.join(request.logDir, GENERATED_NPCS_LOG_FILE);
  const markdown = [
    "## NPC Generation",
    "",
    `Prompt: ${request.prompt}`,
    "",
    ...request.npcs.flatMap((npc) => [
      `### ${npc.id}. ${npc.name}`,
      "",
      `Description: ${npc.description}`,
      "",
      `Bio: ${npc.bio}`,
      ""
    ])
  ].join("\n");
  await writeFile(filePath, `${markdown.trimEnd()}\n\n`, {
    flag: "a",
    encoding: "utf8"
  });
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

const readNpcList = (npcs: GeneratedNpc[]): GeneratedNpc[] => npcs.map((npc) => ({ ...npc }));

const readMaxNpcId = (npcs: GeneratedNpc[]): number => npcs.reduce((maxId, npc) => Math.max(maxId, npc.id), 0);

const stripJsonCodeFence = (response: string): string => {
  const trimmed = response.trim();
  const match = trimmed.match(/^```(?:json)?\s*(?<json>[\s\S]*?)\s*```$/i);
  return match?.groups?.json?.trim() ?? trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
