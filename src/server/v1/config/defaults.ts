import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import type { RuntimeConfig } from "@/types.js";

export const loadDefaultConfig = (repoRoot = process.cwd()): RuntimeConfig => {
  const runtimeDir = path.join(repoRoot, ".eberron-query-assistant");
  const assistantDir = path.join(repoRoot, "assistant");
  const envFile = parseEnvFile(path.join(repoRoot, ".env"));

  return {
    repoRoot,
    assistant: {
      assistantDir,
      additionalContextPath: path.join(assistantDir, "additional-context.md"),
      npcGeneratorPromptPath: path.join(assistantDir, "npc-generator-prompt.md"),
      sessionTitlePromptPath: path.join(assistantDir, "session-title-prompt.md"),
      systemPromptPath: path.join(assistantDir, "system-prompt.md"),
      worldQueryingModePromptPath: path.join(assistantDir, "world-querying-mode-prompt.md")
    },
    campaign: {
      campaignJournalFolder: getConfigValue("EQA_CAMPAIGN_JOURNAL_FOLDER", envFile) ?? "Legacy",
      partyActorUuids: parseCommaSeparatedList(getConfigValue("EQA_PARTY_ACTOR_UUIDS", envFile)),
      questsJournal: getConfigValue("EQA_QUESTS_JOURNAL", envFile) ?? "Quests",
      sessionNotesJournal: getConfigValue("EQA_SESSION_NOTES_JOURNAL", envFile) ?? "Session Notes"
    },
    foundryExportDir: path.join(repoRoot, "foundry-export"),
    pdfDir: path.join(repoRoot, "pdf"),
    runtimeDir,
    logDir: path.join(repoRoot, "logs"),
    stateDir: path.join(runtimeDir, "state"),
    cacheDir: path.join(runtimeDir, "cache"),
    retrievalDir: path.join(runtimeDir, "retrieval"),
    provider: {
      apiKey: getConfigValue("OPENAI_API_KEY", envFile) ?? null,
      baseUrl: normalizeBaseUrl(getConfigValue("OPENAI_BASE_URL", envFile) ?? "https://api.openai.com/v1"),
      chatModel: getConfigValue("OPENAI_CHAT_MODEL", envFile) ?? "gpt-5.4-mini",
      debug: parseBoolean(getConfigValue("EQA_PROVIDER_DEBUG", envFile)),
      embeddingModel: getConfigValue("OPENAI_EMBEDDING_MODEL", envFile) ?? "text-embedding-3-small"
    }
  };
};

const getConfigValue = (key: string, envFile: Record<string, string>): string | undefined => {
  const value = process.env[key] ?? envFile[key];
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const parseEnvFile = (envPath: string): Record<string, string> => {
  if (!existsSync(envPath)) {
    return {};
  }

  const entries: Record<string, string> = {};
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = unwrapEnvValue(rawValue);
  }

  return entries;
};

const unwrapEnvValue = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const parseCommaSeparatedList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parseBoolean = (value: string | undefined): boolean => {
  return value?.toLowerCase() === "true";
};

const normalizeBaseUrl = (value: string): string => {
  return value.replace(/\/+$/, "");
};
