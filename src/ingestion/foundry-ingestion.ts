import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createTaggedError, formatThrownValue, isRecord } from "../errors.js";
import type { FoundryExportMarker } from "../state/index.js";
import type { CorpusChunk, CorpusSource, RuntimeConfig } from "../types.js";
import { chunkText } from "./chunking.js";

export interface FoundryIngestionResult {
  sources: Array<{
    source: CorpusSource;
    chunks: CorpusChunk[];
  }>;
}

export const parseFoundryRecords = async (
  config: RuntimeConfig,
  exportMarker: FoundryExportMarker
): Promise<FoundryIngestionResult> => {
  const recordsPath = path.join(config.foundryExportDir, "records.ndjson");
  const raw = await readFile(recordsPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const sources = lines.map((line, index) => normalizeFoundryLine(line, index, exportMarker));
  return { sources };
};

const normalizeFoundryLine = (
  line: string,
  index: number,
  exportMarker: FoundryExportMarker
): { source: CorpusSource; chunks: CorpusChunk[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw createTaggedError("invalid-foundry-ndjson", `Invalid foundry NDJSON on line ${index + 1}: ${formatThrownValue(error)}`);
  }

  if (!isRecord(parsed)) {
    throw createTaggedError("invalid-foundry-ndjson", `Invalid foundry NDJSON on line ${index + 1}: record must be an object.`);
  }

  const recordId = firstString(parsed, ["recordId", "id", "_id", "uuid", "key"]) ?? hashText(line);
  const entityKind =
    firstString(parsed, ["sourceType", "type", "kind", "entityType", "documentType"]) ??
    readNestedString(parsed, ["metadata", "classification", "documentType"]) ??
    "record";
  const title = firstString(parsed, ["name", "title", "label"]) ?? `${entityKind} ${recordId}`;
  const sourceKey = recordId;
  const sourceId = createSourceId("foundry", sourceKey);
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  const extractedText = body.length > 0 ? body : extractText(parsed);
  const text = extractedText.length > 0 ? extractedText : JSON.stringify(parsed, null, 2);
  const citationAnchor = readNestedString(parsed, ["metadata", "citation", "anchor"]);

  const source: CorpusSource = {
    sourceId,
    sourceType: "foundry",
    sourceKey,
    title,
    status: "succeeded",
    metadata: {
      sourceType: "foundry",
      entityKind,
      title,
      recordId,
      sourceScope: firstString(parsed, ["sourceScope"]),
      sourceId: firstString(parsed, ["sourceId"]),
      sourceUuid: firstString(parsed, ["sourceUuid"]),
      parentId: firstString(parsed, ["parentId"]),
      parentUuid: firstString(parsed, ["parentUuid"]),
      packId: firstString(parsed, ["packId"]),
      provenancePath: readNestedStringArray(parsed, ["metadata", "provenance", "path"]),
      classificationTags: readNestedStringArray(parsed, ["metadata", "classification", "tags"]),
      citationAnchor,
      createdTime: readNestedPrimitive(parsed, ["timestamps", "createdTime"]),
      modifiedTime: readNestedPrimitive(parsed, ["timestamps", "modifiedTime"]),
      exportRunId: exportMarker.runId,
      exportGeneratedAt: exportMarker.generatedAt
    }
  };

  const chunks = chunkText(text).map((chunk, chunkIndex): CorpusChunk => ({
    chunkId: `${sourceId}:chunk:${chunkIndex}`,
    sourceId,
    chunkIndex,
    text: chunk.text,
    citation: {
      sourceType: "foundry",
      label: title,
      locator: citationAnchor ?? entityKind,
      url: null
    },
    metadata: {
      sourceType: "foundry",
      entityKind,
      recordId,
      sourceUuid: firstString(parsed, ["sourceUuid"]),
      provenancePath: readNestedStringArray(parsed, ["metadata", "provenance", "path"]),
      classificationTags: readNestedStringArray(parsed, ["metadata", "classification", "tags"]),
      exportRunId: exportMarker.runId,
      startParagraph: chunk.startParagraph,
      endParagraph: chunk.endParagraph
    }
  }));

  return { source, chunks };
};

const extractText = (value: unknown): string => {
  const textParts: string[] = [];
  collectText(value, textParts, new Set());
  return [...new Set(textParts)].join("\n\n");
};

const collectText = (value: unknown, textParts: string[], seen: Set<unknown>): void => {
  if (typeof value === "string") {
    const text = stripHtml(value).trim();
    if (text.length >= 2) {
      textParts.push(text);
    }
    return;
  }

  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, textParts, seen);
    }
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("_") || key === "img" || key === "image" || key === "flags") {
      continue;
    }
    collectText(item, textParts, seen);
  }
};

const firstString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const readNestedString = (record: Record<string, unknown>, pathSegments: string[]): string | null => {
  const value = readNestedValue(record, pathSegments);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readNestedStringArray = (record: Record<string, unknown>, pathSegments: string[]): string[] => {
  const value = readNestedValue(record, pathSegments);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const readNestedPrimitive = (record: Record<string, unknown>, pathSegments: string[]): string | number | null => {
  const value = readNestedValue(record, pathSegments);
  return typeof value === "string" || typeof value === "number" ? value : null;
};

const readNestedValue = (record: Record<string, unknown>, pathSegments: string[]): unknown => {
  let value: unknown = record;
  for (const segment of pathSegments) {
    if (!isRecord(value)) {
      return null;
    }
    value = value[segment];
  }
  return value;
};

const createSourceId = (sourceType: string, sourceKey: string): string => {
  return `${sourceType}:${hashText(sourceKey)}`;
};

const hashText = (text: string): string => {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
};

const stripHtml = (value: string): string => {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
};
