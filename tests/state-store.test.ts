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
      invalidated: false,
      invalidationReason: null,
      state: {
        appVersion: APP_VERSION,
        foundry: {
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
        lastSuccessfulExport: {
          generatedAt: "2026-04-24T10:00:00.000Z",
          recordCount: 2,
          runId: "run-1"
        }
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
      invalidated: false,
      invalidationReason: null,
      state: {
        ...state,
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

  it("invalidates missing app version state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify({ version: 2 })}\n`, "utf8");

    const result = await store.load(config);

    expect(result.invalidated).toBe(true);
    expect(result.state.appVersion).toBe(APP_VERSION);
    expect(result.state.foundry.lastSuccessfulExport).toBeNull();
  });

  it("loads compatible patch-version state without invalidation", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(
      getStatePath(config),
      `${JSON.stringify({
        appVersion: "0.5.0",
        foundry: { lastSuccessfulExport: null },
        pdf: { knownFilenames: ["a.pdf"] },
        article: { lastSuccessfulIndexScrapeAt: null, knownArticles: [] }
      })}\n`,
      "utf8"
    );

    const result = await store.load(config);

    expect(result.invalidated).toBe(false);
    expect(result.state.appVersion).toBe(APP_VERSION);
    expect(result.state.pdf.knownFilenames).toEqual(["a.pdf"]);
  });

  it("invalidates different app version line state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify({ appVersion: "0.2.0" })}\n`, "utf8");

    const result = await store.load(config);

    expect(result.invalidated).toBe(true);
    expect(result.invalidationReason).toContain("0.2.0");
  });

  it("invalidates malformed app version state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createFilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify({ appVersion: "not-semver" })}\n`, "utf8");

    const result = await store.load(config);

    expect(result.invalidated).toBe(true);
    expect(result.invalidationReason).toContain("not-semver");
  });
});
