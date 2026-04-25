import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createTaggedError, formatThrownValue, hasErrorCode, isRecord } from "../errors.js";
import type { FoundryExportMarker, RuntimeState } from "../state/index.js";
import type {
  RuntimeConfig,
  RuntimeOptions,
  SourceInventoryResult,
  SourceInventoryStatus,
  SourceType
} from "../types.js";
import type { SourceDiscoveryService, SourceDiscoverySummary } from "./source-discovery-service.js";

const ARTICLE_INDEX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FilesystemSourceDiscoveryOptions {
  now?: () => Date;
}

export function createFilesystemSourceDiscoveryService(
  options: FilesystemSourceDiscoveryOptions = {}
): SourceDiscoveryService {
  const now = options.now ?? (() => new Date());

  const inspectFoundry = async (
    config: RuntimeConfig,
    options: RuntimeOptions,
    state: RuntimeState,
    nextState: RuntimeState
  ): Promise<SourceInventoryResult> => {
    const manifestPath = path.join(config.foundryExportDir, "manifest.json");

    try {
      const manifest = parseFoundryManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
      const previous = state.foundry.lastSuccessfulExport;
      const changed = !previous || !markersEqual(previous, manifest);
      const scheduled = options.forceReingest || changed;

      nextState.foundry.lastSuccessfulExport = manifest;

      if (!scheduled) {
        return createInventoryResult({
          sourceType: "foundry",
          discovered: 1,
          status: "skipped",
          message: "foundry: export unchanged; skipping foundry refresh."
        });
      }

      return createInventoryResult({
        sourceType: "foundry",
        discovered: 1,
        added: previous ? 0 : 1,
        updated: previous ? 1 : 0,
        status: "scheduled",
        message: options.forceReingest
          ? "foundry: force re-ingest requested; scheduling foundry refresh."
          : "foundry: export changed; scheduling foundry refresh.",
        details: [`runId=${manifest.runId}`, `generatedAt=${manifest.generatedAt}`, `recordCount=${manifest.recordCount}`]
      });
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return createInventoryResult({
          sourceType: "foundry",
          failed: 1,
          status: "failed",
          message: `foundry: manifest missing at ${manifestPath}.`
        });
      }

      return createInventoryResult({
        sourceType: "foundry",
        failed: 1,
        status: "failed",
        message: `foundry: failed to inspect manifest: ${formatThrownValue(error)}.`
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
}

function parseFoundryManifest(value: unknown): FoundryExportMarker {
  if (!isRecord(value)) {
    throw createManifestError("manifest must contain an object");
  }

  const run = value.run;
  if (!isRecord(run)) {
    throw createManifestError("manifest.run must contain an object");
  }

  const runId = run.runId;
  const generatedAt = run.generatedAt;
  const recordCount = run.recordCount ?? value.recordCount;

  if (typeof runId !== "string" || runId.length === 0) {
    throw createManifestError("manifest.run.runId must be a non-empty string");
  }

  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw createManifestError("manifest.run.generatedAt must be a non-empty string");
  }

  if (typeof recordCount !== "number" || !Number.isInteger(recordCount) || recordCount < 0) {
    throw createManifestError("manifest.run.recordCount must be a non-negative integer");
  }

  return {
    generatedAt,
    recordCount,
    runId
  };
}

function markersEqual(
  left: FoundryExportMarker,
  right: FoundryExportMarker
): boolean {
  return left.generatedAt === right.generatedAt && left.recordCount === right.recordCount && left.runId === right.runId;
}

function createInventoryResult(options: {
  sourceType: SourceType;
  discovered?: number;
  added?: number;
  updated?: number;
  removed?: number;
  failed?: number;
  status: SourceInventoryStatus;
  message: string;
  details?: string[];
}): SourceInventoryResult {
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
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    appVersion: state.appVersion,
    foundry: {
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
}

function createManifestError(message: string): unknown {
  return createTaggedError("invalid-foundry-manifest", message);
}
