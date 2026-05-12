import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createDefaultRuntimeState } from '@/server/v1/state/state-store.js';
import { createFilesystemSourceDiscoveryService } from '@/server/v1/source-discovery/index.js';

const TEST_ROOT = path.resolve(".test-tmp", "source-discovery");
const NOW = new Date("2026-04-24T12:00:00.000Z");

describe("FilesystemSourceDiscoveryService", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("creates a missing foundry export directory and treats it as empty", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.pdfDir, { recursive: true });
    await writeFile(path.join(config.pdfDir, "new.pdf"), "", "utf8");

    const summary = await inspect(config);

    expect(await readdir(config.foundryExportDir)).toEqual([]);
    expect(summary.degraded).toBe(false);
    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "skipped",
      discovered: 0
    });
    expect(summary.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "scheduled",
      added: 1
    });
  });

  it("treats an empty foundry export directory as skipped without degradation", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });

    const summary = await inspect(config);

    expect(summary.degraded).toBe(false);
    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "skipped",
      discovered: 0
    });
  });

  it("schedules one new foundry delta export file", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-1", 4);

    const summary = await inspect(config);

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 1,
      added: 1,
      details: ["scheduled:20260424T100000000Z-foundry-export.ndjson"]
    });
    expect(summary.nextState.foundry.lastSuccessfulExport).toMatchObject({
      filename: "20260424T100000000Z-foundry-export.ndjson",
      runId: "run-1"
    });
  });

  it("schedules foundry NDJSON exports whose filenames do not match the legacy timestamp pattern", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "alpha.ndjson", "run-a", 4);

    const summary = await inspect(config);

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 1,
      added: 1,
      details: ["scheduled:alpha.ndjson"]
    });
    expect(summary.nextState.foundry.lastSuccessfulExport).toMatchObject({
      filename: "alpha.ndjson",
      runId: "run-a"
    });
  });

  it("schedules multiple unapplied foundry delta export files oldest to newest", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T110000000Z-foundry-export.ndjson", "run-2", 5);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-1", 4);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = createMarker("20260424T090000000Z-foundry-export.ndjson", "run-0", 3);
    state.foundry.appliedExportFilenames = ["20260424T090000000Z-foundry-export.ndjson"];

    const summary = await inspect(config, { state });

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 2,
      updated: 2,
      details: [
        "scheduled:20260424T100000000Z-foundry-export.ndjson",
        "scheduled:20260424T110000000Z-foundry-export.ndjson"
      ]
    });
    expect(summary.nextState.foundry.appliedExportFilenames).toEqual([
      "20260424T090000000Z-foundry-export.ndjson",
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson"
    ]);
  });

  it("schedules late backfilled foundry delta export files before the latest applied marker", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-a", 4);
    await writeDeltaExport(config.foundryExportDir, "20260424T110000000Z-foundry-export.ndjson", "run-b", 5);
    await writeDeltaExport(config.foundryExportDir, "20260424T120000000Z-foundry-export.ndjson", "run-c", 6);
    await writeDeltaExport(config.foundryExportDir, "20260424T130000000Z-foundry-export.ndjson", "run-d", 7);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = createMarker("20260424T130000000Z-foundry-export.ndjson", "run-d", 7);
    state.foundry.appliedExportFilenames = [
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson",
      "20260424T130000000Z-foundry-export.ndjson"
    ];

    const summary = await inspect(config, { state });

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 4,
      updated: 1,
      details: ["scheduled:20260424T120000000Z-foundry-export.ndjson"]
    });
    expect(summary.nextState.foundry.appliedExportFilenames).toEqual([
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson",
      "20260424T120000000Z-foundry-export.ndjson",
      "20260424T130000000Z-foundry-export.ndjson"
    ]);
    expect(summary.nextState.foundry.lastSuccessfulExport?.filename).toBe("20260424T130000000Z-foundry-export.ndjson");
  });

  it("skips already-applied foundry delta export files", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-1", 4);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = createMarker("20260424T100000000Z-foundry-export.ndjson", "run-1", 4);
    state.foundry.appliedExportFilenames = ["20260424T100000000Z-foundry-export.ndjson"];

    const summary = await inspect(config, { state });

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "skipped",
      discovered: 1,
      updated: 0,
      details: []
    });
  });

  it("force re-ingest schedules all foundry delta export files and skips when none exist", async () => {
    const emptyConfig = loadDefaultConfig(path.join(TEST_ROOT, "empty-force"));
    const emptySummary = await inspect(emptyConfig, { forceReingest: true });

    expect(emptySummary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "skipped",
      discovered: 0
    });

    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-1", 4);
    await writeDeltaExport(config.foundryExportDir, "20260424T110000000Z-foundry-export.ndjson", "run-2", 5);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = createMarker("20260424T110000000Z-foundry-export.ndjson", "run-2", 5);
    state.foundry.appliedExportFilenames = [
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson"
    ];

    const summary = await inspect(config, { forceReingest: true, state });

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 2,
      updated: 2,
      details: [
        "scheduled:20260424T100000000Z-foundry-export.ndjson",
        "scheduled:20260424T110000000Z-foundry-export.ndjson"
      ]
    });
    expect(summary.nextState.foundry.appliedExportFilenames).toEqual([
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson"
    ]);
  });

  it("inspects all NDJSON foundry export filenames and ignores non-NDJSON files", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson", "run-1", 4);
    await writeDeltaExport(config.foundryExportDir, "records.ndjson", "run-2", 5);
    await writeDeltaExport(config.foundryExportDir, "20260424T100000000Z-other.ndjson", "run-3", 6);
    await writeFile(path.join(config.foundryExportDir, "notes.txt"), "not scanned", "utf8");

    const summary = await inspect(config);

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      discovered: 3,
      added: 3,
      details: [
        "scheduled:20260424T100000000Z-foundry-export.ndjson",
        "scheduled:20260424T100000000Z-other.ndjson",
        "scheduled:records.ndjson"
      ]
    });
  });

  it("fails foundry discovery for invalid delta manifest envelopes", async () => {
    const cases: Array<{ filename: string; firstLine: string }> = [
      {
        filename: "20260424T100000000Z-foundry-export.ndjson",
        firstLine: "{"
      },
      {
        filename: "20260424T110000000Z-foundry-export.ndjson",
        firstLine: JSON.stringify({ kind: "upsert", manifest: validManifest("run-1", 1) })
      },
      {
        filename: "20260424T120000000Z-foundry-export.ndjson",
        firstLine: JSON.stringify({
          kind: "manifest",
          manifest: { ...validManifest("run-1", 1), schemaVersion: "1.0.0" }
        })
      },
      {
        filename: "20260424T130000000Z-foundry-export.ndjson",
        firstLine: JSON.stringify({
          kind: "manifest",
          manifest: { ...validManifest("run-1", 1), run: { ...validManifest("run-1", 1).run, upsertCount: -1 } }
        })
      }
    ];

    for (const testCase of cases) {
      await rm(TEST_ROOT, { force: true, recursive: true });
      const config = loadDefaultConfig(TEST_ROOT);
      await mkdir(config.foundryExportDir, { recursive: true });
      await writeFile(path.join(config.foundryExportDir, testCase.filename), `${testCase.firstLine}\n`, "utf8");

      const summary = await inspect(config);

      expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
        status: "failed",
        failed: 1
      });
    }
  });

  it("detects added, removed, unchanged, and forced PDF inventory", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.pdfDir, { recursive: true });
    await writeFile(path.join(config.pdfDir, "new.pdf"), "", "utf8");
    await writeFile(path.join(config.pdfDir, "same.pdf"), "", "utf8");

    const state = createDefaultRuntimeState();
    state.pdf.knownFilenames = ["removed.pdf", "same.pdf"];

    const changed = await inspect(config, { state });
    expect(changed.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "scheduled",
      discovered: 2,
      added: 1,
      removed: 1
    });
    expect(changed.nextState.pdf.knownFilenames).toEqual(["new.pdf", "same.pdf"]);

    state.pdf.knownFilenames = ["new.pdf", "same.pdf"];
    const unchanged = await inspect(config, { state });
    expect(unchanged.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "skipped",
      added: 0,
      removed: 0
    });

    const forced = await inspect(config, { forceReingest: true, state });
    expect(forced.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "scheduled",
      added: 2
    });
  });

  it("treats a missing PDF directory as zero discovered PDFs", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const summary = await inspect(config);

    expect(summary.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "skipped",
      discovered: 0
    });
  });

  it("applies weekly article scrape cadence without network access", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();

    const missingTimestamp = await inspect(config, { state });
    expect(missingTimestamp.inventories.find((inventory) => inventory.sourceType === "article")).toMatchObject({
      status: "scheduled"
    });

    state.article.lastSuccessfulIndexScrapeAt = "2026-04-20T12:00:00.000Z";
    const recent = await inspect(config, { state });
    expect(recent.inventories.find((inventory) => inventory.sourceType === "article")).toMatchObject({
      status: "skipped"
    });

    state.article.lastSuccessfulIndexScrapeAt = "2026-04-17T12:00:00.000Z";
    const stale = await inspect(config, { state });
    expect(stale.inventories.find((inventory) => inventory.sourceType === "article")).toMatchObject({
      status: "scheduled"
    });

    state.article.lastSuccessfulIndexScrapeAt = "2026-04-24T11:00:00.000Z";
    const forced = await inspect(config, { forceReingest: true, state });
    expect(forced.inventories.find((inventory) => inventory.sourceType === "article")).toMatchObject({
      status: "scheduled"
    });
  });
});

const inspect = async (
  config = loadDefaultConfig(TEST_ROOT),
  options: {
    forceReingest?: boolean;
    state?: ReturnType<typeof createDefaultRuntimeState>;
  } = {}
) => {
  const service = createFilesystemSourceDiscoveryService({ now: () => NOW });
  return service.inspectSources(
    config,
    { forceReingest: options.forceReingest ?? false },
    options.state ?? createDefaultRuntimeState()
  );
};

const writeDeltaExport = async (foundryExportDir: string, filename: string, runId: string, recordCount: number) => {
  await mkdir(foundryExportDir, { recursive: true });
  await writeFile(
    path.join(foundryExportDir, filename),
    `${JSON.stringify({
      kind: "manifest",
      manifest: validManifest(runId, recordCount)
    })}\n`,
    "utf8"
  );
};

const validManifest = (runId: string, recordCount: number) => ({
  schemaVersion: "2.0.0",
  run: {
    deleteCount: 0,
    generatedAt: "2026-04-24T10:00:00.000Z",
    recordCount,
    runId,
    upsertCount: recordCount
  }
});

const createMarker = (filename: string, runId: string, recordCount: number) => ({
  deleteCount: 0,
  filename,
  generatedAt: "2026-04-24T10:00:00.000Z",
  recordCount,
  runId,
  schemaVersion: "2.0.0",
  upsertCount: recordCount
});
