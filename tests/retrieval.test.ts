import Database from "better-sqlite3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { isRecord } from "../src/errors.js";
import { createSqliteCorpusStore, getCorpusDatabasePath, type CorpusStore } from "../src/ingestion/index.js";
import { createDeterministicEmbeddingAdapter, type EmbeddingAdapter } from "../src/provider/index.js";
import { createMemoryProgressReporter, type ProgressReporter } from "../src/progress/reporter.js";
import { createSqliteRetrievalService, getVectorIndexPath } from "../src/retrieval/index.js";
import type { TimingContext } from "../src/timing.js";
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
    expect(counted.embedBatch).toHaveBeenCalledTimes(1);

    const incompatible = createRetrieval(countingAdapter("model-b", "schema-a").adapter);
    await expect(incompatible.refresh(config)).resolves.toMatchObject({
      chunkCount: 3,
      reusedEmbeddings: 0,
      regeneratedEmbeddings: 3
    });
  });

  it("rejects incompatible SQLite artifacts without explicit reset", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.retrievalDir, { recursive: true });
    const database = new Database(getCorpusDatabasePath(config));
    database.exec("CREATE TABLE sources (legacy_id TEXT PRIMARY KEY)");
    database.close();

    const store = createStore();
    await store.initialize(config).then(
      () => {
        throw new Error("Expected incompatible corpus schema to fail.");
      },
      (error: unknown) => {
        expect(error).toMatchObject({ kind: "incompatible-corpus-schema" });
        expect(isRecord(error) && typeof error.message === "string" ? error.message : "").toContain(
          "browser force-reingest control"
        );
      }
    );
  });

  it("recreates incompatible SQLite artifacts only when explicit reset is allowed", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.retrievalDir, { recursive: true });
    const database = new Database(getCorpusDatabasePath(config));
    database.exec("CREATE TABLE sources (legacy_id TEXT PRIMARY KEY)");
    database.close();

    const store = createStore();
    await store.initialize(config, { allowIncompatibleReset: true });
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

  it("stores vector embeddings in SQLite instead of rewriting a JSON artifact", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);

    await expect(readFile(getVectorIndexPath(config), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVectorRows(config)).toHaveLength(3);

    const second = await retrieval.refresh(config);
    expect(second).toMatchObject({ chunkCount: 3, reusedEmbeddings: 3, regeneratedEmbeddings: 0 });
  });

  it("checkpoints generated embeddings so an interrupted refresh can resume", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config, 65);
    const interrupted = interruptingBatchAdapter(1);
    const firstRetrieval = createRetrieval(interrupted.adapter);

    await expect(firstRetrieval.refresh(config)).rejects.toThrow("simulated embedding interruption");
    expect(readVectorRows(config)).toHaveLength(64);

    const resumed = countingAdapter("checkpoint-model", "checkpoint-schema");
    const secondRetrieval = createRetrieval(resumed.adapter);
    const summary = await secondRetrieval.refresh(config);

    expect(summary).toMatchObject({ chunkCount: 65, reusedEmbeddings: 64, regeneratedEmbeddings: 1 });
    expect(resumed.embedBatch).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy vector files during routine refresh and deletes them during force rebuild", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    await mkdir(config.retrievalDir, { recursive: true });
    const counted = countingAdapter("legacy-delete-model", "legacy-delete-schema");
    const legacy = `${JSON.stringify({
      embeddingModelId: "legacy-model",
      embeddingSchemaVersion: "legacy-schema",
      entries: []
    })}\n`;
    await writeFile(getVectorIndexPath(config), legacy, "utf8");

    const retrieval = createRetrieval(counted.adapter);
    const summary = await retrieval.refresh(config);

    await expect(readFile(getVectorIndexPath(config), "utf8")).resolves.toBe(legacy);
    expect(summary).toMatchObject({ chunkCount: 3, reusedEmbeddings: 0, regeneratedEmbeddings: 3 });
    expect(counted.embedBatch).toHaveBeenCalledTimes(1);
    expect(readVectorRows(config)).toHaveLength(3);

    await retrieval.refresh(config, { forceRebuild: true });
    await expect(readFile(getVectorIndexPath(config), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports embedding sync start, progress, and final summary", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config, 65);
    const reporter = createMemoryProgressReporter();
    const retrieval = createRetrieval(createDeterministicEmbeddingAdapter(), reporter);

    await retrieval.refresh(config);

    expect(reporter.messages.some((message) => message.startsWith("Retrieval embedding sync started:"))).toBe(true);
    expect(reporter.messages.filter((message) => message.startsWith("Retrieval embedding sync progress:"))).toHaveLength(2);
    expect(reporter.messages.some((message) => message.startsWith("Retrieval vector index synchronized:"))).toBe(true);
  });

  it("bounds oversized chunk text before requesting embeddings", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = createStore();
    await store.initialize(config);
    await store.replaceSource(config, source("pdf", "oversized.pdf", "Oversized"), [
      chunk("pdf:oversized.pdf:0", "pdf:oversized.pdf", 0, "a".repeat(30_000), {
        sourceType: "pdf",
        label: "Oversized",
        locator: "page 1",
        url: null
      })
    ]);
    const adapter = captureEmbeddingInputAdapter();
    const retrieval = createRetrieval(adapter.adapter);

    await retrieval.refresh(config);

    expect(adapter.inputs[0]?.[0]).toHaveLength(6_000);
  });

  it("bounds oversized query text before requesting query embeddings", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const adapter = captureEmbeddingInputAdapter();
    const retrieval = createRetrieval(adapter.adapter);

    await retrieval.refresh(config);
    await retrieval.search({ query: "query-token ".repeat(2_000), limit: 1 });

    expect(adapter.singleInputs[0]).toHaveLength(6_000);
  });

  it("deletes stale vector rows when chunks are removed", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = await seedCorpus(config);
    const retrieval = createRetrieval();

    await retrieval.refresh(config);
    expect(readVectorRows(config)).toHaveLength(3);

    await store.removeSource(config, "pdf", "eberron.pdf");
    await retrieval.refresh(config);

    expect(readVectorRows(config).map((row) => row.chunk_id)).not.toContain("pdf:eberron.pdf:0");
    expect(readVectorRows(config)).toHaveLength(2);
  });

  it("reuses cached compatible vectors on later searches without reading mutated SQLite vector JSON", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const retrieval = createRetrieval();
    const timing = createCapturingTimingContext();

    await retrieval.refresh(config);
    const first = await retrieval.search({ query: "deathless aerenal", limit: 3, timing });
    rewriteVectorJson(config, "not-json");
    const second = await retrieval.search({ query: "deathless aerenal", limit: 3, timing });

    expect(second).toEqual(first);
    expect(timing.labels).toContain("retrieval.vector.read_vectors");
  });

  it("invalidates and repopulates cached vectors after routine refresh", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const store = await seedCorpus(config);
    const retrieval = createRetrieval(keywordEmbeddingAdapter("aerenal", "mror"));

    await retrieval.refresh(config);
    const first = await retrieval.search({ query: "aerenal", limit: 1 });
    rewriteVectorJson(config, JSON.stringify([0, 1]));

    await store.replaceSource(config, source("pdf", "eberron.pdf", "Eberron Rising"), [
      chunk("pdf:eberron.pdf:0", "pdf:eberron.pdf", 0, "Mror dwarves study the Holds.", {
        sourceType: "pdf",
        label: "Eberron Rising",
        locator: "page 5",
        url: null
      })
    ]);
    await retrieval.refresh(config);
    rewriteVectorJson(config, JSON.stringify([1, 0]), "pdf:eberron.pdf:0");
    const second = await retrieval.search({ query: "mror", limit: 1 });

    expect(first[0]?.chunkId).toBe("pdf:eberron.pdf:0");
    expect(first[0]?.content).toContain("Aerenal");
    expect(second[0]?.chunkId).toBe("pdf:eberron.pdf:0");
    expect(second[0]?.content).toContain("Mror");
  });

  it("invalidates and repopulates cached vectors after force rebuild", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await seedCorpus(config);
    const adapter = countingAdapter("force-cache-model", "force-cache-schema");
    const retrieval = createRetrieval(adapter.adapter);

    await retrieval.refresh(config);
    rewriteVectorJson(config, "not-json");
    await retrieval.refresh(config, { forceRebuild: true });
    rewriteVectorJson(config, "not-json");

    await expect(retrieval.search({ query: "deathless aerenal", limit: 1 })).resolves.toHaveLength(1);
    expect(adapter.embedBatch).toHaveBeenCalledTimes(2);
  });
});

const seedCorpus = async (config: RuntimeConfig, chunkCount = 3): Promise<CorpusStore> => {
  const store = createStore();
  await store.initialize(config);

  if (chunkCount === 3) {
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
  }

  const chunks = Array.from({ length: chunkCount }, (_, index) => {
    return chunk(
      `pdf:eberron.pdf:${index}`,
      "pdf:eberron.pdf",
      index,
      `Aerenal chunk ${index} keeps deathless counselors.`,
      {
        sourceType: "pdf",
        label: "Eberron Rising",
        locator: `page ${index + 1}`,
        url: null
      }
    );
  });

  await store.replaceSource(config, source("pdf", "eberron.pdf", "Eberron Rising"), chunks);
  return store;
};

const createStore = (): CorpusStore => {
  const store = createSqliteCorpusStore();
  stores.push(store);
  return store;
};

const createRetrieval = (
  embeddingAdapter: EmbeddingAdapter = createDeterministicEmbeddingAdapter(),
  reporter: ProgressReporter = {
    info: () => undefined,
    warn: () => undefined
  }
) => {
  return createSqliteRetrievalService({
    embeddingAdapter,
    reporter
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

const countingAdapter = (
  modelId: string,
  schemaVersion: string
): { adapter: EmbeddingAdapter; embed: ReturnType<typeof vi.fn>; embedBatch: ReturnType<typeof vi.fn> } => {
  const base = createDeterministicEmbeddingAdapter();
  const embed = vi.fn((input: string) => base.embed(input));
  const embedBatch = vi.fn((inputs: string[]) => base.embedBatch(inputs));
  return {
    adapter: {
      failedRetries: 0,
      modelId,
      schemaVersion,
      embed,
      embedBatch
    },
    embed,
    embedBatch
  };
};

const interruptingBatchAdapter = (failAfterSuccessfulBatches: number): { adapter: EmbeddingAdapter } => {
  const base = createDeterministicEmbeddingAdapter();
  let successfulBatches = 0;

  return {
    adapter: {
      failedRetries: 0,
      modelId: "checkpoint-model",
      schemaVersion: "checkpoint-schema",
      embed: (input) => base.embed(input),
      async embedBatch(inputs) {
        if (successfulBatches >= failAfterSuccessfulBatches) {
          throw new Error("simulated embedding interruption");
        }
        successfulBatches += 1;
        return base.embedBatch(inputs);
      }
    }
  };
};

const captureEmbeddingInputAdapter = (): { adapter: EmbeddingAdapter; inputs: string[][]; singleInputs: string[] } => {
  const base = createDeterministicEmbeddingAdapter();
  const inputs: string[][] = [];
  const singleInputs: string[] = [];

  return {
    adapter: {
      failedRetries: 0,
      modelId: "capture-model",
      schemaVersion: "capture-schema",
      embed(input) {
        singleInputs.push(input);
        return base.embed(input);
      },
      embedBatch(batchInputs) {
        inputs.push(batchInputs);
        return base.embedBatch(batchInputs);
      }
    },
    inputs,
    singleInputs
  };
};

const keywordEmbeddingAdapter = (...keywords: string[]): EmbeddingAdapter => {
  const embedKeywordVector = (input: string): number[] => {
    const lower = input.toLowerCase();
    const vector = keywords.map((keyword) => (lower.includes(keyword) ? 1 : 0));
    return vector.some((value) => value > 0) ? vector : keywords.map(() => 0);
  };

  return {
    failedRetries: 0,
    modelId: `keyword-${keywords.join("-")}`,
    schemaVersion: "keyword-v1",
    embed(input) {
      return Promise.resolve(embedKeywordVector(input));
    },
    embedBatch(inputs) {
      return Promise.resolve(inputs.map(embedKeywordVector));
    }
  };
};

const createCapturingTimingContext = (): TimingContext & { labels: string[] } => {
  const labels: string[] = [];
  return {
    labels,
    operation: "test",
    operationId: "test",
    reporter: {
      async time(_context, label, task) {
        labels.push(label);
        return task();
      }
    }
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

const readVectorRows = (config: RuntimeConfig): Array<Record<string, unknown>> => {
  return readRows(
    config,
    "SELECT chunk_id, content_hash, embedding_model_id, embedding_schema_version, embedding_json FROM chunk_vectors ORDER BY chunk_id"
  );
};

const rewriteVectorJson = (config: RuntimeConfig, embeddingJson: string, chunkId?: string): void => {
  const database = new Database(getCorpusDatabasePath(config));
  try {
    if (chunkId) {
      database.prepare("UPDATE chunk_vectors SET embedding_json = ? WHERE chunk_id = ?").run(embeddingJson, chunkId);
      return;
    }
    database.prepare("UPDATE chunk_vectors SET embedding_json = ?").run(embeddingJson);
  } finally {
    database.close();
  }
};
