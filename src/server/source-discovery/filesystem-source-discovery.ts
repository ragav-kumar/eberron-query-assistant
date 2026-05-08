import { mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";

import { createTaggedError, formatThrownValue, hasErrorCode, isRecord } from "../../errors.js";
import type { FoundryExportMarker, RuntimeState } from "../state/index.js";
import type {
  RuntimeConfig,
  RuntimeOptions,
  SourceInventoryResult,
  SourceInventoryStatus,
  SourceType
} from "../../types.js";
import type { SourceDiscoveryService, SourceDiscoverySummary } from "./source-discovery-service.js";

const ARTICLE_INDEX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const FOUNDRY_EXPORT_FILENAME_PATTERN = /^\d{8}T\d{9}Z-foundry-export\.ndjson$/;
const FOUNDRY_MANIFEST_READ_CHUNK_BYTES = 64 * 1024;
const SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION = "2.0.0";

export interface FilesystemSourceDiscoveryOptions {
  now?: () => Date;
}

export const createFilesystemSourceDiscoveryService = (
  options: FilesystemSourceDiscoveryOptions = {}
): SourceDiscoveryService => {
  const now = options.now ?? (() => new Date());

  const inspectFoundry = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    nextState: RuntimeState
  ): Promise<SourceInventoryResult> => {
    try {
      await mkdir(config.foundryExportDir, { recursive: true });
      const filenames = (await readdir(config.foundryExportDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && FOUNDRY_EXPORT_FILENAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

      if (filenames.length === 0) {
        return createInventoryResult({
          sourceType: "foundry",
          discovered: 0,
          status: "skipped",
          message: "foundry: no timestamped delta export files found; skipping foundry refresh."
        });
      }

      const markers = await Promise.all(
        filenames.map(async (filename) => parseFoundryExportManifest(config.foundryExportDir, filename))
      );
      const previous = state.foundry.lastSuccessfulExport;
      const appliedFilenames = new Set(state.foundry.appliedExportFilenames);
      const scheduledMarkers = options.forceReingest
        ? markers
        : markers.filter((marker) => !appliedFilenames.has(marker.filename));
      if (scheduledMarkers.length === 0) {
        return createInventoryResult({
          sourceType: "foundry",
          discovered: markers.length,
          status: "skipped",
          message: options.forceReingest
            ? "foundry: force re-ingest requested, but no delta export files were available; skipping foundry refresh."
            : "foundry: delta export files already applied; skipping foundry refresh."
        });
      }

      nextState.foundry.appliedExportFilenames = options.forceReingest
        ? scheduledMarkers.map((marker) => marker.filename)
        : [...appliedFilenames, ...scheduledMarkers.map((marker) => marker.filename)].sort((a, b) => a.localeCompare(b));
      nextState.foundry.lastSuccessfulExport = selectLatestAppliedMarker(
        markers,
        nextState.foundry.appliedExportFilenames,
        state.foundry.lastSuccessfulExport
      );

      return createInventoryResult({
        sourceType: "foundry",
        discovered: markers.length,
        added: previous ? 0 : scheduledMarkers.length,
        updated: previous ? scheduledMarkers.length : 0,
        status: "scheduled",
        message: options.forceReingest
          ? `foundry: force re-ingest requested; scheduling ${scheduledMarkers.length} delta export file(s).`
          : `foundry: scheduling ${scheduledMarkers.length} unapplied delta export file(s).`,
        details: scheduledMarkers.map((marker) => `scheduled:${marker.filename}`)
      });
    } catch (error) {
      return createInventoryResult({
        sourceType: "foundry",
        failed: 1,
        status: "failed",
        message: `foundry: failed to inspect delta export files: ${formatThrownValue(error)}.`
      });
    }
  };

  const inspectPdf = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    nextState: RuntimeState
  ): Promise<SourceInventoryResult> => {
    try {
      const entries = await readdir(config.pdfDir, { withFileTypes: true });
      const filenames = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

      const previous = new Set(state.pdf.knownFilenames);
      const current = new Set(filenames);
      const added = filenames.filter((filename) => !previous.has(filename));
      const removed = state.pdf.knownFilenames.filter((filename) => !current.has(filename));
      const scheduledCount = options.forceReingest ? filenames.length : added.length + removed.length;

      nextState.pdf.knownFilenames = filenames;

      if (scheduledCount === 0) {
        return createInventoryResult({
          sourceType: "pdf",
          discovered: filenames.length,
          status: "skipped",
          message: `pdf: ${filenames.length} PDF file(s) unchanged; skipping PDF refresh.`
        });
      }

      return createInventoryResult({
        sourceType: "pdf",
        discovered: filenames.length,
        added: options.forceReingest ? filenames.length : added.length,
        removed: options.forceReingest ? 0 : removed.length,
        status: "scheduled",
        message: options.forceReingest
          ? `pdf: force re-ingest requested; scheduling ${filenames.length} PDF file(s).`
          : `pdf: scheduling PDF inventory changes; added=${added.length}, removed=${removed.length}.`,
        details: [...added.map((filename) => `added:${filename}`), ...removed.map((filename) => `removed:${filename}`)]
      });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        nextState.pdf.knownFilenames = [];
        return createInventoryResult({
          sourceType: "pdf",
          discovered: 0,
          removed: state.pdf.knownFilenames.length,
          status: state.pdf.knownFilenames.length > 0 ? "scheduled" : "skipped",
          message:
            state.pdf.knownFilenames.length > 0
              ? "pdf: PDF directory is missing; scheduling removal of previously known PDFs."
              : "pdf: PDF directory is missing; treating as zero discovered PDFs."
        });
      }

      return createInventoryResult({
        sourceType: "pdf",
        failed: 1,
        status: "failed",
        message: `pdf: failed to inspect PDF directory: ${formatThrownValue(error)}.`
      });
    }
  };

  const inspectArticles = (options: RuntimeOptions, state: RuntimeState): SourceInventoryResult => {
    if (options.forceReingest) {
      return createInventoryResult({
        sourceType: "article",
        discovered: state.article.knownArticles.length,
        updated: 1,
        status: "scheduled",
        message: "article: force re-ingest requested; scheduling Keith Baker index discovery."
      });
    }

    const lastScrape = state.article.lastSuccessfulIndexScrapeAt;
    if (!lastScrape) {
      return createInventoryResult({
        sourceType: "article",
        discovered: state.article.knownArticles.length,
        updated: 1,
        status: "scheduled",
        message: "article: no successful index scrape recorded; scheduling Keith Baker index discovery."
      });
    }

    const lastScrapeTime = Date.parse(lastScrape);
    if (Number.isNaN(lastScrapeTime)) {
      return createInventoryResult({
        sourceType: "article",
        failed: 1,
        status: "failed",
        message: `article: invalid last successful index scrape timestamp: ${lastScrape}.`
      });
    }

    const ageMs = now().getTime() - lastScrapeTime;
    if (ageMs >= ARTICLE_INDEX_INTERVAL_MS) {
      return createInventoryResult({
        sourceType: "article",
        discovered: state.article.knownArticles.length,
        updated: 1,
        status: "scheduled",
        message: "article: last index scrape is at least 7 days old; scheduling Keith Baker index discovery."
      });
    }

    return createInventoryResult({
      sourceType: "article",
      discovered: state.article.knownArticles.length,
      status: "skipped",
      message: "article: recent Keith Baker index scrape recorded; skipping article discovery."
    });
  };

  return {
    async inspectSources(
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState
    ): Promise<SourceDiscoverySummary> {
      const nextState = cloneRuntimeState(state);
      const [foundryInventory, pdfInventory] = await Promise.all([
        inspectFoundry(config, options, state, nextState),
        inspectPdf(config, options, state, nextState)
      ]);
      const inventories = [foundryInventory, pdfInventory, inspectArticles(options, state)];

      return {
        inventories,
        nextState,
        degraded: inventories.some((inventory) => inventory.status === "failed")
      };
    }
  };
};

const parseFoundryExportManifest = async (foundryExportDir: string, filename: string): Promise<FoundryExportMarker> => {
  const exportPath = path.join(foundryExportDir, filename);
  const firstLine = (await readFirstLine(exportPath)).trim();
  if (firstLine.length === 0) {
    throw createManifestError(`${filename}: first line must contain a manifest envelope`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine) as unknown;
  } catch (error) {
    throw createManifestError(`${filename}: invalid manifest JSON: ${formatThrownValue(error)}`);
  }

  return parseFoundryManifestEnvelope(filename, parsed);
};

const selectLatestAppliedMarker = (
  markers: FoundryExportMarker[],
  appliedFilenames: string[],
  fallback: FoundryExportMarker | null
): FoundryExportMarker | null => {
  const markerByFilename = new Map(markers.map((marker) => [marker.filename, marker]));
  const latestFilename = [...appliedFilenames].sort((a, b) => a.localeCompare(b)).at(-1);
  if (!latestFilename) {
    return null;
  }

  return markerByFilename.get(latestFilename) ?? (fallback?.filename === latestFilename ? { ...fallback } : null);
};

const readFirstLine = async (filePath: string): Promise<string> => {
  const file = await open(filePath, "r");
  const chunks: Buffer[] = [];
  let position = 0;

  try {
    while (true) {
      const buffer = Buffer.alloc(FOUNDRY_MANIFEST_READ_CHUNK_BYTES);
      const result = await file.read(buffer, 0, buffer.length, position);
      if (result.bytesRead === 0) {
        return Buffer.concat(chunks).toString("utf8");
      }

      const chunk = buffer.subarray(0, result.bytesRead);
      const newlineIndex = chunk.indexOf(10);
      if (newlineIndex >= 0) {
        chunks.push(chunk.subarray(0, newlineIndex));
        return Buffer.concat(chunks).toString("utf8");
      }

      chunks.push(chunk);
      position += result.bytesRead;
    }
  } finally {
    await file.close();
  }
};

const parseFoundryManifestEnvelope = (filename: string, value: unknown): FoundryExportMarker => {
  if (!isRecord(value)) {
    throw createManifestError(`${filename}: first line must contain a manifest envelope object`);
  }

  if (value.kind !== "manifest") {
    throw createManifestError(`${filename}: first line kind must be manifest`);
  }

  return parseFoundryManifest(filename, value.manifest);
};

const parseFoundryManifest = (filename: string, value: unknown): FoundryExportMarker => {
  if (!isRecord(value)) {
    throw createManifestError(`${filename}: manifest must contain an object`);
  }

  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION) {
    throw createManifestError(
      `${filename}: manifest.schemaVersion must be ${SUPPORTED_FOUNDRY_EXPORT_SCHEMA_VERSION}`
    );
  }

  const run = value.run;
  if (!isRecord(run)) {
    throw createManifestError(`${filename}: manifest.run must contain an object`);
  }

  const runId = run.runId;
  const generatedAt = run.generatedAt;
  const recordCount = run.recordCount;
  const upsertCount = run.upsertCount;
  const deleteCount = run.deleteCount;

  if (typeof runId !== "string" || runId.length === 0) {
    throw createManifestError(`${filename}: manifest.run.runId must be a non-empty string`);
  }

  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw createManifestError(`${filename}: manifest.run.generatedAt must be a non-empty string`);
  }

  if (typeof recordCount !== "number" || !Number.isInteger(recordCount) || recordCount < 0) {
    throw createManifestError(`${filename}: manifest.run.recordCount must be a non-negative integer`);
  }

  if (typeof upsertCount !== "number" || !Number.isInteger(upsertCount) || upsertCount < 0) {
    throw createManifestError(`${filename}: manifest.run.upsertCount must be a non-negative integer`);
  }

  if (typeof deleteCount !== "number" || !Number.isInteger(deleteCount) || deleteCount < 0) {
    throw createManifestError(`${filename}: manifest.run.deleteCount must be a non-negative integer`);
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

const createInventoryResult = (options: {
  sourceType: SourceType;
  discovered?: number;
  added?: number;
  updated?: number;
  removed?: number;
  failed?: number;
  status: SourceInventoryStatus;
  message: string;
  details?: string[];
}): SourceInventoryResult => {
  return {
    sourceType: options.sourceType,
    discovered: options.discovered ?? 0,
    added: options.added ?? 0,
    updated: options.updated ?? 0,
    removed: options.removed ?? 0,
    failed: options.failed ?? 0,
    status: options.status,
    message: options.message,
    details: options.details ?? []
  };
};

const cloneRuntimeState = (state: RuntimeState): RuntimeState => {
  return {
    appVersion: state.appVersion,
    foundry: {
      appliedExportFilenames: [...state.foundry.appliedExportFilenames],
      lastSuccessfulExport: state.foundry.lastSuccessfulExport ? { ...state.foundry.lastSuccessfulExport } : null
    },
    pdf: {
      knownFilenames: [...state.pdf.knownFilenames]
    },
    article: {
      lastSuccessfulIndexScrapeAt: state.article.lastSuccessfulIndexScrapeAt,
      knownArticles: state.article.knownArticles.map((article) => ({ ...article }))
    }
  };
};

const createManifestError = (message: string): unknown => {
  return createTaggedError("invalid-foundry-manifest", message);
};
