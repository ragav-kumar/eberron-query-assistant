import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createPlaceholderIngestionService } from "../src/ingestion/index.js";
import { createMemoryProgressReporter } from "../src/progress/reporter.js";
import { runRuntime } from "../src/runtime/index.js";
import { runStartupRefresh } from "../src/runtime/refresh.js";
import { createFilesystemSourceDiscoveryService, createPlaceholderSourceDiscoveryService } from "../src/source-discovery/index.js";
import { createFilesystemStateStore, createPlaceholderStateStore } from "../src/state/index.js";
import { createDefaultRuntimeState } from "../src/state/state-store.js";

const TEST_ROOT = path.resolve(".test-tmp", "runtime");
const PLACEHOLDER_ROOT = path.resolve(".test-tmp", "runtime-placeholder");

describe("startup refresh skeleton", () => {
  it("emits readable source inventory progress", async () => {
    const reporter = createMemoryProgressReporter();

    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: true, retrievalQuery: null }, {
      discovery: createPlaceholderSourceDiscoveryService(),
      ingestion: createPlaceholderIngestionService(),
      reporter,
      stateStore: createPlaceholderStateStore()
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
      { forceReingest: false, retrievalQuery: null },
      {
        config: loadDefaultConfig(PLACEHOLDER_ROOT),
        discovery: createPlaceholderSourceDiscoveryService(),
        ingestion: createPlaceholderIngestionService(),
        prompt,
        retrieval: {
          refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
          search: vi.fn().mockResolvedValue([])
        },
        reporter: createMemoryProgressReporter(),
        stateStore: createPlaceholderStateStore()
      }
    );

    expect(prompt.start).toHaveBeenCalledOnce();
    expect(summary.degraded).toBe(false);
    expect(summary.inventories).toHaveLength(3);
  });

  it("prints retrieval debug results and skips the prompt", async () => {
    const prompt = {
      start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    const retrieval = {
      refresh: vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 0, regeneratedEmbeddings: 1 }),
      search: vi.fn().mockResolvedValue([
        {
          chunkId: "pdf:eberron.pdf:0",
          sourceId: "pdf:eberron.pdf",
          sourceType: "pdf" as const,
          sourceKey: "eberron.pdf",
          sourceTitle: "Eberron Rising",
          content: "Aerenal keeps deathless counselors.",
          citation: {
            sourceType: "pdf" as const,
            label: "Eberron Rising",
            locator: "page 4",
            url: null
          },
          score: 0.9,
          matchKind: "hybrid" as const
        }
      ])
    };
    const reporter = createMemoryProgressReporter();

    await runRuntime(
      { forceReingest: false, retrievalQuery: "aerenal deathless" },
      {
        config: loadDefaultConfig(PLACEHOLDER_ROOT),
        discovery: createPlaceholderSourceDiscoveryService(),
        ingestion: createPlaceholderIngestionService(),
        prompt,
        retrieval,
        reporter,
        stateStore: createPlaceholderStateStore()
      }
    );

    expect(retrieval.search).toHaveBeenCalledWith({
      query: "aerenal deathless",
      limit: 8
    });
    expect(prompt.start).not.toHaveBeenCalled();
    expect(reporter.messages.some((message) => message.startsWith("Results for"))).toBe(true);
  });

  it("commits successful source inventory state during startup refresh", async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });

    try {
      const config = loadDefaultConfig(TEST_ROOT);
      const stateStore = createFilesystemStateStore();
      const initialState = createDefaultRuntimeState();
      initialState.article.lastSuccessfulIndexScrapeAt = "2026-04-24T10:00:00.000Z";

      await stateStore.save(config, initialState);
      await writeManifest(config.foundryExportDir, "run-1", "2026-04-24T10:00:00.000Z", 2);
      await mkdir(config.pdfDir, { recursive: true });
      await writeFile(path.join(config.pdfDir, "rising.pdf"), "", "utf8");

      const summary = await runStartupRefresh(config, { forceReingest: false, retrievalQuery: null }, {
        discovery: createFilesystemSourceDiscoveryService({ now: () => new Date("2026-04-24T12:00:00.000Z") }),
        ingestion: createPlaceholderIngestionService(),
        reporter: createMemoryProgressReporter(),
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

const writeManifest = async (foundryExportDir: string, runId: string, generatedAt: string, recordCount: number) => {
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
};
