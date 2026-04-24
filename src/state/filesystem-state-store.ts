import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeConfig } from "../types.js";
import { createDefaultRuntimeState, type ArticleStateRecord, type RuntimeState, type StateStore } from "./state-store.js";

const STATE_FILENAME = "runtime-state.json";

export class UnsupportedStateVersionError extends Error {
  constructor(version: unknown) {
    super(`Unsupported runtime state version: ${String(version)}.`);
    this.name = "UnsupportedStateVersionError";
  }
}

export class InvalidRuntimeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuntimeStateError";
  }
}

export class FilesystemStateStore implements StateStore {
  async load(config: RuntimeConfig): Promise<RuntimeState> {
    const statePath = getStatePath(config);

    let raw: string;
    try {
      raw = await readFile(statePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createDefaultRuntimeState();
      }

      throw error;
    }

    const parsed = JSON.parse(raw) as unknown;
    return parseRuntimeState(parsed);
  }

  async save(config: RuntimeConfig, state: RuntimeState): Promise<void> {
    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify(normalizeRuntimeState(state), null, 2)}\n`, "utf8");
  }
}

export function getStatePath(config: RuntimeConfig): string {
  return path.join(config.stateDir, STATE_FILENAME);
}

function parseRuntimeState(value: unknown): RuntimeState {
  if (!isRecord(value)) {
    throw new InvalidRuntimeStateError("Runtime state file must contain an object.");
  }

  if (value.version !== 1) {
    throw new UnsupportedStateVersionError(value.version);
  }

  if (!isRecord(value.foundry)) {
    throw new InvalidRuntimeStateError("Runtime state field foundry must be an object.");
  }

  if (!isRecord(value.pdf)) {
    throw new InvalidRuntimeStateError("Runtime state field pdf must be an object.");
  }

  if (!isRecord(value.article)) {
    throw new InvalidRuntimeStateError("Runtime state field article must be an object.");
  }

  return normalizeRuntimeState({
    version: 1,
    foundry: {
      lastSuccessfulExport: parseFoundryMarker(value.foundry.lastSuccessfulExport)
    },
    pdf: {
      knownFilenames: parseStringArray(value.pdf.knownFilenames, "pdf.knownFilenames")
    },
    article: {
      lastSuccessfulIndexScrapeAt: parseNullableString(
        value.article.lastSuccessfulIndexScrapeAt,
        "article.lastSuccessfulIndexScrapeAt"
      ),
      knownArticles: parseArticleRecords(value.article.knownArticles)
    }
  });
}

function normalizeRuntimeState(state: RuntimeState): RuntimeState {
  return {
    version: 1,
    foundry: {
      lastSuccessfulExport: state.foundry.lastSuccessfulExport
        ? {
            generatedAt: state.foundry.lastSuccessfulExport.generatedAt,
            recordCount: state.foundry.lastSuccessfulExport.recordCount,
            runId: state.foundry.lastSuccessfulExport.runId
          }
        : null
    },
    pdf: {
      knownFilenames: [...new Set(state.pdf.knownFilenames)].sort((a, b) => a.localeCompare(b))
    },
    article: {
      lastSuccessfulIndexScrapeAt: state.article.lastSuccessfulIndexScrapeAt,
      knownArticles: [...state.article.knownArticles].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl))
    }
  };
}

function parseFoundryMarker(value: unknown): RuntimeState["foundry"]["lastSuccessfulExport"] {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new InvalidRuntimeStateError("foundry.lastSuccessfulExport must be an object or null.");
  }

  const generatedAt = parseRequiredString(value.generatedAt, "foundry.lastSuccessfulExport.generatedAt");
  const runId = parseRequiredString(value.runId, "foundry.lastSuccessfulExport.runId");
  const recordCount = value.recordCount;

  if (typeof recordCount !== "number" || !Number.isInteger(recordCount) || recordCount < 0) {
    throw new InvalidRuntimeStateError("foundry.lastSuccessfulExport.recordCount must be a non-negative integer.");
  }

  return {
    generatedAt,
    recordCount,
    runId
  };
}

function parseArticleRecords(value: unknown): ArticleStateRecord[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InvalidRuntimeStateError("article.knownArticles must be an array.");
  }

  return value.map((record, index) => {
    if (!isRecord(record)) {
      throw new InvalidRuntimeStateError(`article.knownArticles[${index}] must be an object.`);
    }

    const scrapeStatus = record.scrapeStatus;
    if (scrapeStatus !== "pending" && scrapeStatus !== "succeeded" && scrapeStatus !== "failed") {
      throw new InvalidRuntimeStateError(`article.knownArticles[${index}].scrapeStatus is invalid.`);
    }

    return {
      canonicalUrl: parseRequiredString(record.canonicalUrl, `article.knownArticles[${index}].canonicalUrl`),
      title: parseNullableString(record.title, `article.knownArticles[${index}].title`),
      firstSeenAt: parseRequiredString(record.firstSeenAt, `article.knownArticles[${index}].firstSeenAt`),
      lastIngestedAt: parseNullableString(record.lastIngestedAt, `article.knownArticles[${index}].lastIngestedAt`),
      scrapeStatus
    };
  });
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new InvalidRuntimeStateError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidRuntimeStateError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function parseNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new InvalidRuntimeStateError(`${fieldName} must be a string or null.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
