import Database from "better-sqlite3";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createSqliteCorpusStore, getCorpusDatabasePath, type CorpusStore } from "../src/ingestion/index.js";
import { createDeterministicEmbeddingAdapter, type EmbeddingAdapter } from "../src/provider/index.js";
import { createSqliteRetrievalService, getVectorIndexPath } from "../src/retrieval/index.js";
import type { CorpusChunk, CorpusSource, RuntimeConfig, SourceType } from "../src/types.js";

const TEST_ROOT = path.resolve(".test-tmp", "retrieval");
const stores: CorpusStore[] = [];

describe("Phase 4 retrieval", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("searches mixed source chunks with citation metadata", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);
    const results = await retrieval.search({ query: "deathless aerenal", limit: 3 });

    expect(results[0]).toMatchObject({
      sourceType: "pdf",
      sourceKey: "eberron.pdf",
      sourceTitle: "Eberron Rising",
      citation: {
        label: "Eberron Rising",
        locator: "page 4"
      }
    });
    expect(results[0]?.content).toContain("Aerenal");
    store.close();
  });

  it("filters retrieval by source type and source key", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);
    const articleResults = await retrieval.search({
      query: "deathless gnomes",
      sourceTypes: ["article"],
      limit: 5
    });
    const foundryResults = await retrieval.search({
      query: "aerenal",
      sourceKeys: ["actor-ashana"],
      limit: 5
    });

    expect(articleResults).toHaveLength(1);
    expect(articleResults[0]?.sourceType).toBe("article");
    expect(foundryResults).toHaveLength(1);
    expect(foundryResults[0]?.sourceKey).toBe("actor-ashana");
  });

  it("removes stale source chunks from retrieval results", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);
    await expect(retrieval.search({ query: "deathless", sourceKeys: ["eberron.pdf"] })).resolves.toHaveLength(1);

    await store.removeSource(config, "pdf", "eberron.pdf");
    await retrieval.refresh(config, { forceRebuild: true });

    await expect(retrieval.search({ query: "deathless", sourceKeys: ["eberron.pdf"] })).resolves.toHaveLength(0);
  });

  it("reuses compatible embeddings and regenerates incompatible embeddings", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const counted = countingAdapter("model-a", "schema-a");
    const retrieval = createRetrieval(counted.adapter);

    const first = await retrieval.refresh(config);
    const second = await retrieval.refresh(config);

    expect(first).toMatchObject({ chunkCount: 3, reusedEmbeddings: 0, regeneratedEmbeddings: 3 });
    expect(second).toMatchObject({ chunkCount: 3, reusedEmbeddings: 3, regeneratedEmbeddings: 0 });
    expect(counted.embed).toHaveBeenCalledTimes(3);

    const incompatible = createRetrieval(countingAdapter("model-b", "schema-a").adapter);
    await expect(incompatible.refresh(config)).resolves.toMatchObject({
      chunkCount: 3,
      reusedEmbeddings: 0,
      regeneratedEmbeddings: 3
    });
  });

  it("recreates incompatible SQLite artifacts before corpus use", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.retrievalDir, { recursive: true });
    const database = new Database(getCorpusDatabasePath(config));
    database.exec("CREATE TABLE sources (legacy_id TEXT PRIMARY KEY)");
    database.close();

    const store = createStore();
    await store.initialize(config);
    await store.replaceSource(config, source("pdf", "eberron.pdf", "Eberron Rising"), [
      chunk("pdf:eberron.pdf:0", "pdf:eberron.pdf", 0, "Aerenal keeps deathless counselors.", {
        sourceType: "pdf",
        label: "Eberron Rising",
        locator: "page 4",
        url: null
      })
    ]);

    const rows = readRows(config, "SELECT source_key FROM sources");
    expect(rows).toEqual([{ source_key: "eberron.pdf" }]);
  });

  it("writes a vector artifact that can be rebuilt from SQLite chunks", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);
    const before = JSON.parse(await readFile(getVectorIndexPath(config), "utf8")) as { entries: unknown[] };
    await rm(getVectorIndexPath(config), { force: true });
    const rebuilt = await retrieval.refresh(config);
    const after = JSON.parse(await readFile(getVectorIndexPath(config), "utf8")) as { entries: unknown[] };

    expect(before.entries).toHaveLength(3);
    expect(rebuilt.regeneratedEmbeddings).toBe(3);
    expect(after.entries).toHaveLength(3);
  });
});

const seedCorpus = async (config: RuntimeConfig): Promise<CorpusStore> => {
  const store = createStore();
  await store.initialize(config);
  await store.replaceSource(config, source("pdf", "eberron.pdf", "Eberron Rising"), [
    chunk("pdf:eberron.pdf:0", "pdf:eberron.pdf", 0, "Aerenal keeps deathless counselors.", {
      sourceType: "pdf",
      label: "Eberron Rising",
      locator: "page 4",
      url: null
    })
  ]);
  await store.replaceSource(config, source("article", "https://keith-baker.com/aerenal/", "Aerenal Notes"), [
    chunk(
      "article:https://keith-baker.com/aerenal/:0",
      "article:https://keith-baker.com/aerenal/",
      0,
      "Keith Baker writes about gnomes and the Trust.",
      {
        sourceType: "article",
        label: "Aerenal Notes",
        locator: null,
        url: "https://keith-baker.com/aerenal/"
      }
    )
  ]);
  await store.replaceSource(config, source("foundry", "actor-ashana", "Ashana"), [
    chunk("foundry:actor-ashana:0", "foundry:actor-ashana", 0, "Ashana has a contact in Aerenal.", {
      sourceType: "foundry",
      label: "Ashana",
      locator: "Actor",
      url: null
    })
  ]);
  return store;
};

const createStore = (): CorpusStore => {
  const store = createSqliteCorpusStore();
  stores.push(store);
  return store;
};

const createRetrieval = (embeddingAdapter: EmbeddingAdapter = createDeterministicEmbeddingAdapter()) => {
  return createSqliteRetrievalService({
    embeddingAdapter,
    reporter: {
      info: () => undefined,
      warn: () => undefined
    }
  });
};

const source = (sourceType: SourceType, sourceKey: string, title: string): CorpusSource => {
  return {
    sourceId: `${sourceType}:${sourceKey}`,
    sourceType,
    sourceKey,
    title,
    metadata: {},
    status: "succeeded"
  };
};

const chunk = (
  chunkId: string,
  sourceId: string,
  chunkIndex: number,
  text: string,
  citation: CorpusChunk["citation"]
): CorpusChunk => {
  return {
    chunkId,
    sourceId,
    chunkIndex,
    text,
    citation,
    metadata: {}
  };
};

const countingAdapter = (modelId: string, schemaVersion: string): { adapter: EmbeddingAdapter; embed: ReturnType<typeof vi.fn> } => {
  const base = createDeterministicEmbeddingAdapter();
  const embed = vi.fn((input: string) => base.embed(input));
  return {
    adapter: {
      modelId,
      schemaVersion,
      embed
    },
    embed
  };
};

const readRows = (config: RuntimeConfig, sql: string): Array<Record<string, unknown>> => {
  const database = new Database(getCorpusDatabasePath(config), { readonly: true });
  try {
    return database.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
};
