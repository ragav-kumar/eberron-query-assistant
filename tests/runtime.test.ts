import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { PlaceholderIngestionService } from "../src/ingestion/index.js";
import { MemoryProgressReporter } from "../src/progress/reporter.js";
import { runRuntime } from "../src/runtime/index.js";
import { runStartupRefresh } from "../src/runtime/refresh.js";
import { FilesystemSourceDiscoveryService, PlaceholderSourceDiscoveryService } from "../src/source-discovery/index.js";
import { FilesystemStateStore, PlaceholderStateStore } from "../src/state/index.js";
import { createDefaultRuntimeState } from "../src/state/state-store.js";

const TEST_ROOT = path.resolve(".test-tmp", "runtime");
const PLACEHOLDER_ROOT = path.resolve(".test-tmp", "runtime-placeholder");

describe("startup refresh skeleton", () => {
  it("emits readable source inventory progress", async () => {
    const reporter = new MemoryProgressReporter();

    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: true }, {
      discovery: new PlaceholderSourceDiscoveryService(),
      ingestion: new PlaceholderIngestionService(),
      reporter,
      stateStore: new PlaceholderStateStore()
    });

    expect(reporter.messages).toContain("Starting source inventory checks.");
    expect(reporter.messages).toContain("Force re-ingest requested; source inventory will schedule all available sources.");
    expect(reporter.messages).toContain("Ingestion refresh complete.");
    expect(reporter.messages).toContain("Startup refresh complete; entering assistant prompt.");
    expect(reporter.messages.some((message) => message.startsWith("foundry: placeholder inventory skipped."))).toBe(
      true
    );
  });

  it("reaches the prompt boundary after startup", async () => {
    const prompt = {
      start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    const summary = await runRuntime(
      { forceReingest: false },
      {
        config: loadDefaultConfig(PLACEHOLDER_ROOT),
        discovery: new PlaceholderSourceDiscoveryService(),
        ingestion: new PlaceholderIngestionService(),
        prompt,
        reporter: new MemoryProgressReporter(),
        stateStore: new PlaceholderStateStore()
      }
    );

    expect(prompt.start).toHaveBeenCalledOnce();
    expect(summary.degraded).toBe(false);
    expect(summary.inventories).toHaveLength(3);
  });

  it("commits successful source inventory state during startup refresh", async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });

    try {
      const config = loadDefaultConfig(TEST_ROOT);
      const stateStore = new FilesystemStateStore();
      const initialState = createDefaultRuntimeState();
      initialState.article.lastSuccessfulIndexScrapeAt = "2026-04-24T10:00:00.000Z";

      await stateStore.save(config, initialState);
      await writeManifest(config.foundryExportDir, "run-1", "2026-04-24T10:00:00.000Z", 2);
      await mkdir(config.pdfDir, { recursive: true });
      await writeFile(path.join(config.pdfDir, "rising.pdf"), "", "utf8");

      const summary = await runStartupRefresh(config, { forceReingest: false }, {
        discovery: new FilesystemSourceDiscoveryService({ now: () => new Date("2026-04-24T12:00:00.000Z") }),
        ingestion: new PlaceholderIngestionService(),
        reporter: new MemoryProgressReporter(),
        stateStore
      });

      const persisted = await stateStore.load(config);

      expect(summary.degraded).toBe(false);
      expect(persisted.state.foundry.lastSuccessfulExport).toEqual({
        generatedAt: "2026-04-24T10:00:00.000Z",
        recordCount: 2,
        runId: "run-1"
      });
      expect(persisted.state.pdf.knownFilenames).toEqual(["rising.pdf"]);
      expect(persisted.state.article.lastSuccessfulIndexScrapeAt).toBe("2026-04-24T10:00:00.000Z");
    } finally {
      await rm(TEST_ROOT, { force: true, recursive: true });
    }
  });
});

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
