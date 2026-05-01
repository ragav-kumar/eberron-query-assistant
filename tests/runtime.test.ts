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
import { createDefaultRuntimeState, type RuntimeState } from "../src/state/state-store.js";

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
    expect(summary.degradedSources).toEqual([]);
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
      expect(summary.degradedSources).toEqual([]);
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

  it("does not save runtime state when retrieval refresh fails", async () => {
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    nextState.pdf.knownFilenames = ["new.pdf"];
    const save = vi.fn<(_config: ReturnType<typeof loadDefaultConfig>, _state: RuntimeState) => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false, retrievalQuery: null }, {
        discovery: {
          inspectSources: vi.fn().mockResolvedValue({
            degraded: false,
            nextState,
            inventories: []
          })
        },
        ingestion: {
          ingest: vi.fn().mockResolvedValue({
            nextState,
            summary: {
              corpusSourceCount: 1,
              degraded: false,
              sourceSummaries: []
            }
          })
        },
        reporter: createMemoryProgressReporter(),
        retrieval: {
          refresh: vi.fn().mockRejectedValue(new Error("simulated retrieval failure")),
          search: vi.fn().mockResolvedValue([])
        },
        stateStore: {
          load: vi.fn().mockResolvedValue({ state }),
          save
        }
      })
    ).rejects.toThrow("simulated retrieval failure");

    expect(save).not.toHaveBeenCalled();
  });

  it("does not save runtime state or refresh retrieval when ingestion leaves an empty corpus", async () => {
    const state = createDefaultRuntimeState();
    const save = vi.fn<(_config: ReturnType<typeof loadDefaultConfig>, _state: RuntimeState) => Promise<void>>().mockResolvedValue(undefined);
    const retrieval = {
      refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
      search: vi.fn().mockResolvedValue([])
    };

    await expect(
      runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false, retrievalQuery: null }, {
        discovery: {
          inspectSources: vi.fn().mockResolvedValue({
            degraded: false,
            nextState: state,
            inventories: []
          })
        },
        ingestion: {
          ingest: vi.fn().mockResolvedValue({
            nextState: state,
            summary: {
              corpusSourceCount: 0,
              degraded: true,
              sourceSummaries: []
            }
          })
        },
        reporter: createMemoryProgressReporter(),
        retrieval,
        stateStore: {
          load: vi.fn().mockResolvedValue({ state }),
          save
        }
      })
    ).rejects.toMatchObject({ kind: "empty-corpus" });

    expect(retrieval.refresh).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("names degraded source types in startup output", async () => {
    const state = createDefaultRuntimeState();
    const reporter = createMemoryProgressReporter();

    const summary = await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false, retrievalQuery: null }, {
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: true,
          nextState: state,
          inventories: [
            {
              sourceType: "foundry",
              discovered: 0,
              added: 0,
              updated: 0,
              removed: 0,
              failed: 1,
              status: "failed",
              message: "foundry: failed.",
              details: []
            },
            {
              sourceType: "pdf",
              discovered: 1,
              added: 1,
              updated: 0,
              removed: 0,
              failed: 0,
              status: "scheduled",
              message: "pdf: scheduled.",
              details: []
            }
          ]
        })
      },
      ingestion: {
        ingest: vi.fn().mockResolvedValue({
          nextState: state,
          summary: {
            corpusSourceCount: 1,
            degraded: true,
            sourceSummaries: [
              {
                sourceType: "foundry",
                status: "skipped",
                discovered: 0,
                ingested: 0,
                removed: 0,
                failed: 0,
                message: "foundry: ingestion skipped.",
                details: []
              },
              {
                sourceType: "pdf",
                status: "succeeded",
                discovered: 1,
                ingested: 0,
                removed: 0,
                failed: 1,
                message: "pdf: ingestion completed with source-scoped failures.",
                details: ["new.pdf: parse failed"]
              }
            ]
          }
        })
      },
      reporter,
      stateStore: createPlaceholderStateStore()
    });

    expect(summary.degraded).toBe(true);
    expect(summary.degradedSources).toEqual(["foundry", "pdf"]);
    expect(reporter.warnings.some((message) => message.includes("degradedSources=foundry, pdf"))).toBe(true);
    expect(reporter.warnings.some((message) => message.includes("foundry: discovery failed."))).toBe(true);
    expect(reporter.warnings.some((message) => message.includes("pdf: partial ingestion failure."))).toBe(true);
  });

  it("forces retrieval rebuild only for force re-ingest", async () => {
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    const retrieval = {
      refresh: vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 0, regeneratedEmbeddings: 1 }),
      search: vi.fn().mockResolvedValue([])
    };
    const dependencies = {
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: false,
          nextState,
          inventories: []
        })
      },
      ingestion: {
        ingest: vi.fn().mockResolvedValue({
          nextState,
          summary: {
            corpusSourceCount: 1,
            degraded: false,
            sourceSummaries: []
          }
        })
      },
      reporter: createMemoryProgressReporter(),
      retrieval,
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      }
    };

    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false, retrievalQuery: null }, dependencies);
    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: true, retrievalQuery: null }, dependencies);

    expect(retrieval.refresh).toHaveBeenNthCalledWith(1, loadDefaultConfig(PLACEHOLDER_ROOT), {
      forceRebuild: false
    });
    expect(retrieval.refresh).toHaveBeenNthCalledWith(2, loadDefaultConfig(PLACEHOLDER_ROOT), {
      forceRebuild: true
    });
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
