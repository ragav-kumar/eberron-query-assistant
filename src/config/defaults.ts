import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import type { RuntimeConfig } from "../types.js";

export const loadDefaultConfig = (repoRoot = process.cwd()): RuntimeConfig => {
  const runtimeDir = path.join(repoRoot, ".eberron-query-assistant");
  const envFile = parseEnvFile(path.join(repoRoot, ".env"));

  return {
    repoRoot,
    foundryExportDir: path.join(repoRoot, "foundry-export"),
    pdfDir: path.join(repoRoot, "pdf"),
    runtimeDir,
    stateDir: path.join(runtimeDir, "state"),
    cacheDir: path.join(runtimeDir, "cache"),
    retrievalDir: path.join(runtimeDir, "retrieval"),
    provider: {
      apiKey: getConfigValue("OPENAI_API_KEY", envFile) ?? null,
      baseUrl: normalizeBaseUrl(getConfigValue("OPENAI_BASE_URL", envFile) ?? "https://api.openai.com/v1"),
      chatModel: getConfigValue("OPENAI_CHAT_MODEL", envFile) ?? "gpt-5.2",
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

const normalizeBaseUrl = (value: string): string => {
  return value.replace(/\/+$/, "");
};
