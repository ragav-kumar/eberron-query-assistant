import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAppVersion } from "../../app-version.js";
import { createTaggedError, hasErrorCode, isRecord } from "../../errors.js";
import type { RuntimeConfig } from "../../types.js";
import {
  createDefaultRuntimeState,
  type ArticleStateRecord,
  type RuntimeState,
  type RuntimeStateLoadResult,
  type StateStore
} from "./state-store.js";

const STATE_FILENAME = "runtime-state.json";

export interface InvalidRuntimeStateError {
  kind: "invalid-runtime-state";
  message: string;
  name: string;
}

export const createFilesystemStateStore = (): StateStore => {
  return {
    async load(config) {
      const statePath = getStatePath(config);

      let raw: string;
      try {
        raw = await readFile(statePath, "utf8");
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
          return {
            state: createDefaultRuntimeState()
          };
        }

        throw error;
      }

      const parsed = JSON.parse(raw) as unknown;
      return parseRuntimeState(parsed);
    },

    async save(config, state) {
      await mkdir(config.stateDir, { recursive: true });
      await writeFile(getStatePath(config), `${JSON.stringify(normalizeRuntimeState(state), null, 2)}\n`, "utf8");
    }
  };
};

export const isInvalidRuntimeStateError = (value: unknown): value is InvalidRuntimeStateError => {
  return isRecord(value) && value.kind === "invalid-runtime-state" && typeof value.message === "string";
};

export const getStatePath = (config: RuntimeConfig): string => {
  return path.join(config.stateDir, STATE_FILENAME);
};

const parseRuntimeState = (value: unknown): RuntimeStateLoadResult => {
  const appVersion = getAppVersion();
  if (!isRecord(value)) {
    throw createInvalidRuntimeStateError("Runtime state file must contain an object.");
  }

  if (!isRecord(value.foundry)) {
    throw createInvalidRuntimeStateError("Runtime state field foundry must be an object.");
  }

  if (!isRecord(value.pdf)) {
    throw createInvalidRuntimeStateError("Runtime state field pdf must be an object.");
  }

  if (!isRecord(value.article)) {
    throw createInvalidRuntimeStateError("Runtime state field article must be an object.");
  }

  return {
    state: normalizeRuntimeState({
      appVersion,
      foundry: {
        appliedExportFilenames: parseStringArray(value.foundry.appliedExportFilenames, "foundry.appliedExportFilenames"),
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
    })
  };
};

const normalizeRuntimeState = (state: RuntimeState): RuntimeState => {
  return {
    appVersion: getAppVersion(),
    foundry: {
      appliedExportFilenames: [...new Set(state.foundry.appliedExportFilenames)].sort((a, b) => a.localeCompare(b)),
      lastSuccessfulExport: state.foundry.lastSuccessfulExport
        ? {
            deleteCount: state.foundry.lastSuccessfulExport.deleteCount,
            filename: state.foundry.lastSuccessfulExport.filename,
            generatedAt: state.foundry.lastSuccessfulExport.generatedAt,
            recordCount: state.foundry.lastSuccessfulExport.recordCount,
            runId: state.foundry.lastSuccessfulExport.runId,
            schemaVersion: state.foundry.lastSuccessfulExport.schemaVersion,
            upsertCount: state.foundry.lastSuccessfulExport.upsertCount
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
};

const parseFoundryMarker = (value: unknown): RuntimeState["foundry"]["lastSuccessfulExport"] => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw createInvalidRuntimeStateError("foundry.lastSuccessfulExport must be an object or null.");
  }

  if (typeof value.filename !== "string") {
    return null;
  }

  const deleteCount = value.deleteCount;
  const filename = parseRequiredString(value.filename, "foundry.lastSuccessfulExport.filename");
  const generatedAt = parseRequiredString(value.generatedAt, "foundry.lastSuccessfulExport.generatedAt");
  const runId = parseRequiredString(value.runId, "foundry.lastSuccessfulExport.runId");
  const recordCount = value.recordCount;
  const schemaVersion = parseRequiredString(value.schemaVersion, "foundry.lastSuccessfulExport.schemaVersion");
  const upsertCount = value.upsertCount;

  if (typeof recordCount !== "number" || !Number.isInteger(recordCount) || recordCount < 0) {
    throw createInvalidRuntimeStateError("foundry.lastSuccessfulExport.recordCount must be a non-negative integer.");
  }

  if (typeof upsertCount !== "number" || !Number.isInteger(upsertCount) || upsertCount < 0) {
    throw createInvalidRuntimeStateError("foundry.lastSuccessfulExport.upsertCount must be a non-negative integer.");
  }

  if (typeof deleteCount !== "number" || !Number.isInteger(deleteCount) || deleteCount < 0) {
    throw createInvalidRuntimeStateError("foundry.lastSuccessfulExport.deleteCount must be a non-negative integer.");
  }

  return {
    deleteCount,
    filename,
    generatedAt,
    recordCount,
    runId,
    schemaVersion,
    upsertCount
  };
};

const parseArticleRecords = (value: unknown): ArticleStateRecord[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createInvalidRuntimeStateError("article.knownArticles must be an array.");
  }

  return value.map((record, index) => {
    if (!isRecord(record)) {
      throw createInvalidRuntimeStateError(`article.knownArticles[${index}] must be an object.`);
    }

    const scrapeStatus = record.scrapeStatus;
    if (scrapeStatus !== "pending" && scrapeStatus !== "succeeded" && scrapeStatus !== "failed" && scrapeStatus !== "inaccessible") {
      throw createInvalidRuntimeStateError(`article.knownArticles[${index}].scrapeStatus is invalid.`);
    }

    return {
      canonicalUrl: parseRequiredString(record.canonicalUrl, `article.knownArticles[${index}].canonicalUrl`),
      title: parseNullableString(record.title, `article.knownArticles[${index}].title`),
      firstSeenAt: parseRequiredString(record.firstSeenAt, `article.knownArticles[${index}].firstSeenAt`),
      lastIngestedAt: parseNullableString(record.lastIngestedAt, `article.knownArticles[${index}].lastIngestedAt`),
      scrapeStatus
    };
  });
};

const parseStringArray = (value: unknown, fieldName: string): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw createInvalidRuntimeStateError(`${fieldName} must be an array of strings.`);
  }

  return value;
};

const parseRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw createInvalidRuntimeStateError(`${fieldName} must be a non-empty string.`);
  }

  return value;
};

const parseNullableString = (value: unknown, fieldName: string): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw createInvalidRuntimeStateError(`${fieldName} must be a string or null.`);
  }

  return value;
};

const createInvalidRuntimeStateError = (message: string): InvalidRuntimeStateError => {
  return createTaggedError("invalid-runtime-state", message) as InvalidRuntimeStateError;
};
