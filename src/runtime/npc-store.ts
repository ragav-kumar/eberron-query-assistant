import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasErrorCode } from "../errors.js";
import type { RuntimeConfig } from "../types.js";
import type { GeneratedNpc } from "./npc-session.js";

export interface StoredGeneratedNpc extends GeneratedNpc {
  createdAt: string;
  updatedAt: string;
}

const GENERATED_NPCS_STATE_FILE = "generated-npcs.json";
const LEGACY_GENERATED_NPCS_LOG_FILE = "generated_npcs.md";

export const readGeneratedNpcState = async (config: RuntimeConfig): Promise<GeneratedNpc[]> => {
  return sortStoredNpcsForDisplay(await readStoredGeneratedNpcState(config));
};

export const updateGeneratedNpcState = async (
  config: RuntimeConfig,
  updates: GeneratedNpc[],
  now = new Date()
): Promise<GeneratedNpc[]> => {
  const stored = await readStoredGeneratedNpcState(config);
  const existing = new Map(stored.map((npc) => [npc.id, npc]));
  const nowIso = now.toISOString();

  for (const update of updates) {
    const current = existing.get(update.id);
    existing.set(update.id, {
      ...update,
      createdAt: current?.createdAt ?? nowIso,
      updatedAt: nowIso
    });
  }

  const next = sortStoredNpcsForStorage([...existing.values()]);
  await mkdir(config.stateDir, { recursive: true });
  await writeFile(getGeneratedNpcStatePath(config), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return sortStoredNpcsForDisplay(next);
};

export const getGeneratedNpcStatePath = (config: RuntimeConfig): string => {
  return path.join(config.stateDir, GENERATED_NPCS_STATE_FILE);
};

const readStoredGeneratedNpcState = async (config: RuntimeConfig): Promise<StoredGeneratedNpc[]> => {
  const statePath = getGeneratedNpcStatePath(config);
  try {
    return readStoredNpcArray(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  return migrateLegacyGeneratedNpcLog(config);
};

const migrateLegacyGeneratedNpcLog = async (config: RuntimeConfig): Promise<StoredGeneratedNpc[]> => {
  const legacyPath = path.join(config.logDir, LEGACY_GENERATED_NPCS_LOG_FILE);
  let markdown: string;
  let timestamp: string;
  try {
    const [legacyText, legacyStat] = await Promise.all([
      readFile(legacyPath, "utf8"),
      stat(legacyPath)
    ]);
    markdown = legacyText;
    timestamp = legacyStat.mtime.toISOString();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const migrated = parseLegacyGeneratedNpcMarkdown(markdown, timestamp);
  if (migrated.length === 0) {
    return [];
  }

  await mkdir(config.stateDir, { recursive: true });
  await writeFile(getGeneratedNpcStatePath(config), `${JSON.stringify(sortStoredNpcsForStorage(migrated), null, 2)}\n`, "utf8");
  return migrated;
};

export const parseLegacyGeneratedNpcMarkdown = (markdown: string, timestamp: string): StoredGeneratedNpc[] => {
  const headers = [...markdown.matchAll(/^###[ \t]+(?<id>\d+)\.[ \t]+(?<name>.+?)[ \t]*$/gm)];
  const npcs = headers.map((header, index) => {
    const groups = header.groups;
    const nextHeader = headers[index + 1];
    const body = markdown.slice((header.index ?? 0) + header[0].length, nextHeader?.index ?? markdown.length);
    const descriptionMatch = body.match(/\r?\n\r?\nDescription:\s*(?<description>[\s\S]*?)\r?\n\r?\nBio:/);
    const bioMatch = body.match(/\r?\n\r?\nBio:\s*(?<bio>[\s\S]*?)(?=\r?\n\r?\n## NPC Generation|\s*$)/);

    if (!groups || !descriptionMatch?.groups || !bioMatch?.groups) {
      throw new Error("Legacy generated NPC Markdown contains a malformed NPC card.");
    }

    return readStoredNpcRecord({
      id: Number(groups.id),
      name: groups.name,
      description: descriptionMatch.groups.description,
      bio: bioMatch.groups.bio,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });

  assertUniqueNpcIds(npcs);
  return sortStoredNpcsForStorage(npcs);
};

const readStoredNpcArray = (value: unknown): StoredGeneratedNpc[] => {
  if (!Array.isArray(value)) {
    throw new Error("Generated NPC state file must contain a JSON array.");
  }

  const npcs = value.map(readStoredNpcRecord);
  assertUniqueNpcIds(npcs);
  return sortStoredNpcsForStorage(npcs);
};

const readStoredNpcRecord = (value: unknown): StoredGeneratedNpc => {
  const id = isRecord(value) ? value.id : null;
  if (
    !isRecord(value) ||
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id <= 0 ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.bio !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("Generated NPC state file contains an invalid NPC record.");
  }

  const npc = {
    id,
    name: value.name.trim(),
    description: value.description.trim(),
    bio: value.bio.trim(),
    createdAt: value.createdAt.trim(),
    updatedAt: value.updatedAt.trim()
  };
  if (
    npc.name.length === 0 ||
    npc.description.length === 0 ||
    npc.bio.length === 0 ||
    !isValidIsoDate(npc.createdAt) ||
    !isValidIsoDate(npc.updatedAt)
  ) {
    throw new Error("Generated NPC state file contains an invalid NPC record.");
  }

  return npc;
};

const assertUniqueNpcIds = (npcs: StoredGeneratedNpc[]): void => {
  if (new Set(npcs.map((npc) => npc.id)).size !== npcs.length) {
    throw new Error("Generated NPC state file contains duplicate NPC ids.");
  }
};

const sortStoredNpcsForDisplay = (npcs: StoredGeneratedNpc[]): StoredGeneratedNpc[] => {
  return [...npcs].sort((left, right) => {
    const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
    return updatedComparison !== 0 ? updatedComparison : right.id - left.id;
  });
};

const sortStoredNpcsForStorage = (npcs: StoredGeneratedNpc[]): StoredGeneratedNpc[] => {
  return [...npcs].sort((left, right) => left.id - right.id);
};

const isValidIsoDate = (value: string): boolean => {
  return !Number.isNaN(Date.parse(value));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
