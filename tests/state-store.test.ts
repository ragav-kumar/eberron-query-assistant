import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createFilesystemStateStore, getStatePath } from "../src/state/index.js";
import type { RuntimeState } from "../src/state/index.js";
import { getAppVersion } from "../src/app-version.js";

const TEST_ROOT = path.resolve(".test-tmp", "state-store");
const APP_VERSION = getAppVersion();

describe("FilesystemStateStore", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("loads default state when no state file exists", async () => {
    const store = createFilesystemStateStore();

    await expect(store.load(loadDefaultConfig(TEST_ROOT))).resolves.toEqual({
      state: {
        appVersion: APP_VERSION,
        foundry: {
          appliedExportFilenames: [],
          lastSuccessfulExport: null
        },
        pdf: {
          knownFilenames: []
        },
        article: {
          lastSuccessfulIndexScrapeAt: null,
          knownArticles: []
        }
      }
    });
  });

  it("creates the state directory and round-trips deterministic state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();
    const articleA = {
      canonicalUrl: "https://keith-baker.com/a",
      title: "A",
      firstSeenAt: "2026-04-20T10:00:00.000Z",
      lastIngestedAt: "2026-04-20T11:00:00.000Z",
      scrapeStatus: "succeeded" as const
    };
    const articleB = {
      canonicalUrl: "https://keith-baker.com/b",
      title: "B",
      firstSeenAt: "2026-04-20T10:00:00.000Z",
      lastIngestedAt: null,
      scrapeStatus: "pending" as const
    };
    const state: RuntimeState = {
      appVersion: APP_VERSION,
      foundry: {
        appliedExportFilenames: [
          "20260424T110000000Z-foundry-export.ndjson",
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T100000000Z-foundry-export.ndjson"
        ],
        lastSuccessfulExport: createMarker("20260424T100000000Z-foundry-export.ndjson", "run-1", 2)
      },
      pdf: {
        knownFilenames: ["z.pdf", "a.pdf", "a.pdf"]
      },
      article: {
        lastSuccessfulIndexScrapeAt: "2026-04-20T10:00:00.000Z",
        knownArticles: [articleB, articleA]
      }
    };

    await store.save(config, state);

    await expect(store.load(config)).resolves.toEqual({
      state: {
        ...state,
        foundry: {
          ...state.foundry,
          appliedExportFilenames: [
            "20260424T100000000Z-foundry-export.ndjson",
            "20260424T110000000Z-foundry-export.ndjson"
          ]
        },
        pdf: {
          knownFilenames: ["a.pdf", "z.pdf"]
        },
        article: {
          ...state.article,
          knownArticles: [articleA, articleB]
        }
      }
    });

    await expect(mkdir(path.dirname(getStatePath(config)))).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("preserves valid delta export state when app version is missing", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();
    const marker = createMarker("20260424T100000000Z-foundry-export.ndjson", "run-1", 2);

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        foundry: {
          appliedExportFilenames: [marker.filename],
          lastSuccessfulExport: marker
        },
        pdf: { knownFilenames: ["a.pdf"] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    const result = await store.load(config);

    expect(result.state.appVersion).toBe(APP_VERSION);
    expect(result.state.foundry.lastSuccessfulExport).toEqual(marker);
    expect(result.state.pdf.knownFilenames).toEqual(["a.pdf"]);
  });

  it("normalizes legacy foundry export markers to null", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        appVersion: "0.10.0",
        foundry: {
          lastSuccessfulExport: {
            generatedAt: "2026-04-24T10:00:00.000Z",
            recordCount: 2,
            runId: "run-1"
          }
        },
        pdf: { knownFilenames: ["a.pdf"] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    const result = await store.load(config);

    expect(result.state.foundry.lastSuccessfulExport).toBeNull();
    expect(result.state.foundry.appliedExportFilenames).toEqual([]);
    expect(result.state.pdf.knownFilenames).toEqual(["a.pdf"]);
  });

  it("rejects invalid delta export marker fields", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        appVersion: APP_VERSION,
        foundry: {
          appliedExportFilenames: [],
          lastSuccessfulExport: {
            ...createMarker("20260424T100000000Z-foundry-export.ndjson", "run-1", 2),
            deleteCount: -1
          }
        },
        pdf: { knownFilenames: [] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    await expect(store.load(config)).rejects.toMatchObject({
      kind: "invalid-runtime-state",
      message: "foundry.lastSuccessfulExport.deleteCount must be a non-negative integer."
    });
  });

  it("loads state from any app version without invalidation when the shape is valid", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        appVersion: "0.2.0",
        foundry: { lastSuccessfulExport: null },
        pdf: { knownFilenames: ["a.pdf"] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    const result = await store.load(config);

    expect(result.state.appVersion).toBe(APP_VERSION);
    expect(result.state.pdf.knownFilenames).toEqual(["a.pdf"]);
  });

  it("normalizes non-semver app version state when the shape is valid", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        appVersion: "not-semver",
        foundry: { lastSuccessfulExport: null },
        pdf: { knownFilenames: ["a.pdf"] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    const result = await store.load(config);

    expect(result.state.appVersion).toBe(APP_VERSION);
    expect(result.state.pdf.knownFilenames).toEqual(["a.pdf"]);
  });
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
