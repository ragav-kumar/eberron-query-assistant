import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { FilesystemStateStore, getStatePath } from "../src/state/index.js";
import type { RuntimeState } from "../src/state/index.js";

const TEST_ROOT = path.resolve(".test-tmp", "state-store");

describe("FilesystemStateStore", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("loads default version 1 state when no state file exists", async () => {
    const store = new FilesystemStateStore();

    await expect(store.load(loadDefaultConfig(TEST_ROOT))).resolves.toEqual({
      version: 1,
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
    });
  });

  it("creates the state directory and round-trips deterministic state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = new FilesystemStateStore();
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
      version: 1,
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
      ...state,
      pdf: {
        knownFilenames: ["a.pdf", "z.pdf"]
      },
      article: {
        ...state.article,
        knownArticles: [articleA, articleB]
      }
    });

    await expect(mkdir(path.dirname(getStatePath(config)))).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("rejects unsupported state versions", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = new FilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify({ version: 2 })}\n`, "utf8");

    await expect(store.load(config)).rejects.toThrow("Unsupported runtime state version: 2.");
  });

  it("rejects invalid version 1 state instead of silently defaulting missing sections", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = new FilesystemStateStore();

    await mkdir(config.stateDir, { recursive: true });
    await writeFile(getStatePath(config), `${JSON.stringify({ version: 1 })}\n`, "utf8");

    await expect(store.load(config)).rejects.toThrow("Runtime state field foundry must be an object.");
  });
});
