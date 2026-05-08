import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createTaggedError, hasErrorCode } from "../errors.js";
import type { ChatMessage } from "../provider/index.js";
import type { AssistantConfig, RetrievalResult } from "../types.js";

export interface AssistantMessageBuildRequest {
  evidence: RetrievalResult[];
  history?: ChatMessage[];
  includePartyContext?: boolean;
  partyContext?: string;
  promptAssets: AssistantPromptAssets;
  question: string;
  retrievalToolInstructions?: string;
  requestSessionTitle?: boolean;
}

export interface AssistantPromptAssets {
  additionalContext: string;
  npcGeneratorPrompt: string;
  sessionTitlePrompt: string;
  systemPrompt: string;
  worldQueryingModePrompt: string;
}

export const buildAssistantMessages = (request: AssistantMessageBuildRequest): ChatMessage[] => {
  const evidence = formatEvidence(request.evidence);
  const recentHistory = request.history ?? [];
  const includePartyContext = request.includePartyContext ?? true;
  const partyContext = includePartyContext ? (request.partyContext?.trim() ?? "") : "";
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
    includePartyContext ? "" : request.promptAssets.worldQueryingModePrompt,
    request.promptAssets.sessionTitlePrompt,
    request.retrievalToolInstructions?.trim() ?? "",
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

  const [systemPrompt, sessionTitlePrompt, npcGeneratorPrompt, worldQueryingModePrompt, additionalContext] = await Promise.all([
    readRequiredPromptFile(config.systemPromptPath, "system prompt"),
    readRequiredPromptFile(config.sessionTitlePromptPath, "session title prompt"),
    readRequiredPromptFile(config.npcGeneratorPromptPath, "NPC generator prompt"),
    readRequiredPromptFile(config.worldQueryingModePromptPath, "world querying mode prompt"),
    readFile(config.additionalContextPath, "utf8")
  ]);

  return {
    additionalContext: additionalContext.trim(),
    npcGeneratorPrompt: npcGeneratorPrompt.trim(),
    sessionTitlePrompt: sessionTitlePrompt.trim(),
    systemPrompt: systemPrompt.trim(),
    worldQueryingModePrompt: worldQueryingModePrompt.trim()
  };
};

export const formatCitation = (result: RetrievalResult): string => {
  const locator = result.citation.locator ? `, ${result.citation.locator}` : "";
  const url = result.citation.url ? `, ${result.citation.url}` : "";
  return `${result.citation.label}${locator}${url} [${result.sourceType}:${result.sourceKey}]`;
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

export const formatEvidence = (results: RetrievalResult[]): string => {
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
