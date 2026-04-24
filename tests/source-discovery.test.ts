import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createDefaultRuntimeState } from "../src/state/state-store.js";
import { FilesystemSourceDiscoveryService } from "../src/source-discovery/index.js";

const TEST_ROOT = path.resolve(".test-tmp", "source-discovery");
const NOW = new Date("2026-04-24T12:00:00.000Z");

describe("FilesystemSourceDiscoveryService", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("reports a missing foundry manifest without blocking PDF or article checks", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.pdfDir, { recursive: true });
    await writeFile(path.join(config.pdfDir, "new.pdf"), "", "utf8");

    const summary = await inspect(config);

    expect(summary.degraded).toBe(true);
    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "failed",
      failed: 1
    });
    expect(summary.inventories.find((inventory) => inventory.sourceType === "pdf")).toMatchObject({
      status: "scheduled",
      added: 1
    });
  });

  it("skips an unchanged foundry manifest and schedules changed markers", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeManifest(config.foundryExportDir, "run-1", "2026-04-24T10:00:00.000Z", 4);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = {
      generatedAt: "2026-04-24T10:00:00.000Z",
      recordCount: 4,
      runId: "run-1"
    };

    const unchanged = await inspect(config, { state });
    expect(unchanged.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "skipped",
      updated: 0
    });

    await writeManifest(config.foundryExportDir, "run-2", "2026-04-24T10:00:00.000Z", 4);
    const changed = await inspect(config, { state });

    expect(changed.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled",
      updated: 1
    });
  });

  it("force re-ingest schedules an unchanged foundry manifest", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeManifest(config.foundryExportDir, "run-1", "2026-04-24T10:00:00.000Z", 4);

    const state = createDefaultRuntimeState();
    state.foundry.lastSuccessfulExport = {
      generatedAt: "2026-04-24T10:00:00.000Z",
      recordCount: 4,
      runId: "run-1"
    };

    const summary = await inspect(config, { forceReingest: true, state });

    expect(summary.inventories.find((inventory) => inventory.sourceType === "foundry")).toMatchObject({
      status: "scheduled"
    });
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

async function inspect(
  config = loadDefaultConfig(TEST_ROOT),
  options: {
    forceReingest?: boolean;
    state?: ReturnType<typeof createDefaultRuntimeState>;
  } = {}
) {
  const service = new FilesystemSourceDiscoveryService({ now: () => NOW });
  return service.inspectSources(config, { forceReingest: options.forceReingest ?? false }, options.state ?? createDefaultRuntimeState());
}

async function writeManifest(foundryExportDir: string, runId: string, generatedAt: string, recordCount: number) {
  await mkdir(foundryExportDir, { recursive: true });
  await writeFile(
    path.join(foundryExportDir, "manifest.json"),
    `${JSON.stringify({
      run: {
        generatedAt,
        recordCount,
        runId
      }
    })}\n`,
    "utf8"
  );
}
