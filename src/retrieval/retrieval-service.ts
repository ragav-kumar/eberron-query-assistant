import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

import Database from "better-sqlite3";

import type { EmbeddingAdapter } from "../provider/index.js";
import type { ProgressReporter } from "../progress/reporter.js";
import type {
  CitationMetadata,
  RetrievalResult,
  RetrievalSearchRequest,
  RuntimeConfig,
  SourceType
} from "../types.js";
import { getCorpusDatabasePath } from "../ingestion/index.js";

const VECTOR_INDEX_FILENAME = "vector-index.json";
const DEFAULT_LIMIT = 8;
const EMBEDDING_BATCH_SIZE = 64;
const MAX_EMBEDDING_INPUT_CHARACTERS = 24_000;
const VECTOR_STORE_SCHEMA_VERSION = "sqlite-json-v1";
const VECTOR_IMPORT_BATCH_SIZE = 256;

export interface RetrievalSyncSummary {
  chunkCount: number;
  reusedEmbeddings: number;
  regeneratedEmbeddings: number;
}

export interface RetrievalService {
  refresh(config: RuntimeConfig, options?: { forceRebuild?: boolean }): Promise<RetrievalSyncSummary>;
  search(request: RetrievalSearchRequest): Promise<RetrievalResult[]>;
}

export interface RetrievalServiceDependencies {
  embeddingAdapter: EmbeddingAdapter;
  reporter: ProgressReporter;
}

interface StoredChunk {
  chunkId: string;
  sourceId: string;
  sourceType: SourceType;
  sourceKey: string;
  sourceTitle: string;
  content: string;
  citation: CitationMetadata;
  contentHash: string;
}

interface VectorIndexEntry {
  chunkId: string;
  contentHash: string;
  embedding: number[];
}

interface VectorIndexNdjsonHeader {
  format: "vector-index-ndjson-v1";
  embeddingModelId: string;
  embeddingSchemaVersion: string;
}

interface VectorIndexHeader {
  embeddingModelId: string;
  embeddingSchemaVersion: string;
}

interface StoredVectorEntry {
  chunkId: string;
  contentHash: string;
  embedding: number[];
}

export const createSqliteRetrievalService = (dependencies: RetrievalServiceDependencies): RetrievalService => {
  let config: RuntimeConfig | null = null;

  const openDatabase = (): Database.Database => {
    if (!config) {
      throw new Error("Retrieval service must be refreshed before search.");
    }

    return new Database(getCorpusDatabasePath(config), { readonly: true });
  };

  const refresh = async (
    nextConfig: RuntimeConfig,
    options: { forceRebuild?: boolean } = {}
  ): Promise<RetrievalSyncSummary> => {
    config = nextConfig;
    await mkdir(nextConfig.retrievalDir, { recursive: true });

    const database = new Database(getCorpusDatabasePath(nextConfig));
    try {
      database.pragma("foreign_keys = ON");
      rebuildFts(database);
      initializeVectorStore(database);

      if (options.forceRebuild) {
        database.prepare("DELETE FROM chunk_vectors").run();
      }

      const chunks = readAllChunks(database);
      deleteStaleVectorRows(database);
      await importLegacyVectorIndexIfNeeded(database, nextConfig, dependencies.embeddingAdapter, dependencies.reporter);
      const summary = await syncVectorStore(chunks, database, dependencies.embeddingAdapter, dependencies.reporter);

      dependencies.reporter.info(
        `Retrieval vector index synchronized: chunks=${summary.chunkCount}, reused=${summary.reusedEmbeddings}, regenerated=${summary.regeneratedEmbeddings}, model=${dependencies.embeddingAdapter.modelId}.`
      );

      return summary;
    } finally {
      database.close();
    }
  };

  const search = async (request: RetrievalSearchRequest): Promise<RetrievalResult[]> => {
    const limit = request.limit ?? DEFAULT_LIMIT;
    if (request.query.trim().length === 0 || limit <= 0) {
      return [];
    }

    const database = openDatabase();
    try {
      const lexicalResults = searchLexical(database, request, limit);
      const semanticResults = await searchVector(database, request, limit, dependencies.embeddingAdapter);
      return mergeResults(lexicalResults, semanticResults, limit);
    } finally {
      database.close();
    }
  };

  return {
    refresh,
    search
  };
};

export const getVectorIndexPath = (config: RuntimeConfig): string => {
  return path.join(config.retrievalDir, VECTOR_INDEX_FILENAME);
};

const rebuildFts = (database: Database.Database): void => {
  database.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')").run();
};

const initializeVectorStore = (database: Database.Database): void => {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS retrieval_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunk_vectors (
      chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      embedding_model_id TEXT NOT NULL,
      embedding_schema_version TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_vectors_compatibility
      ON chunk_vectors (embedding_model_id, embedding_schema_version, content_hash);
  `);

  database
    .prepare(
      `INSERT INTO retrieval_metadata (key, value)
       VALUES ('vector_store_schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(VECTOR_STORE_SCHEMA_VERSION);
};

const readAllChunks = (database: Database.Database): StoredChunk[] => {
  return (
    database
      .prepare(
        `SELECT
          c.chunk_id AS chunkId,
          c.source_id AS sourceId,
          c.text AS content,
          c.citation_json AS citationJson,
          s.source_type AS sourceType,
          s.source_key AS sourceKey,
          s.title AS sourceTitle
        FROM chunks c
        INNER JOIN sources s ON s.source_id = c.source_id
        ORDER BY c.chunk_id`
      )
      .all() as Array<{
      chunkId: string;
      sourceId: string;
      content: string;
      citationJson: string;
      sourceType: SourceType;
      sourceKey: string;
      sourceTitle: string;
    }>
  ).map((row) => ({
    chunkId: row.chunkId,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceKey: row.sourceKey,
    sourceTitle: row.sourceTitle,
    content: row.content,
    citation: JSON.parse(row.citationJson) as CitationMetadata,
    contentHash: hashContent(row.content)
  }));
};

const searchLexical = (
  database: Database.Database,
  request: RetrievalSearchRequest,
  limit: number
): RetrievalResult[] => {
  const ftsQuery = toFtsQuery(request.query);
  if (!ftsQuery) {
    return [];
  }

  const filters = buildSqlFilters(request, "s");
  const rows = database
    .prepare(
      `SELECT
        c.chunk_id AS chunkId,
        c.source_id AS sourceId,
        c.text AS content,
        c.citation_json AS citationJson,
        s.source_type AS sourceType,
        s.source_key AS sourceKey,
        s.title AS sourceTitle,
        bm25(chunks_fts) AS rank
      FROM chunks_fts
      INNER JOIN chunks c ON chunks_fts.rowid = c.rowid
      INNER JOIN sources s ON s.source_id = c.source_id
      WHERE chunks_fts MATCH ?${filters.sql}
      ORDER BY rank
      LIMIT ?`
    )
    .all(ftsQuery, ...filters.values, limit) as Array<{
    chunkId: string;
    sourceId: string;
    content: string;
    citationJson: string;
    sourceType: SourceType;
    sourceKey: string;
    sourceTitle: string;
    rank: number;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceKey: row.sourceKey,
    sourceTitle: row.sourceTitle,
    content: row.content,
    citation: JSON.parse(row.citationJson) as CitationMetadata,
    score: 1 / (1 + Math.max(0, row.rank)),
    matchKind: "lexical"
  }));
};

const searchVector = async (
  database: Database.Database,
  request: RetrievalSearchRequest,
  limit: number,
  embeddingAdapter: EmbeddingAdapter
): Promise<RetrievalResult[]> => {
  const chunks = readAllChunks(database).filter((chunk) => matchesRequestFilters(chunk, request));
  if (chunks.length === 0) {
    return [];
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const queryEmbedding = await embeddingAdapter.embed(request.query);

  return readCompatibleVectorRows(database, embeddingAdapter)
    .map((entry) => {
      const chunk = chunkById.get(entry.chunkId);
      if (!chunk || chunk.contentHash !== entry.contentHash) {
        return null;
      }

      return {
        chunk,
        score: cosineSimilarity(queryEmbedding, entry.embedding)
      };
    })
    .filter((entry): entry is { chunk: StoredChunk; score: number } => entry !== null)
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      chunkId: chunk.chunkId,
      sourceId: chunk.sourceId,
      sourceType: chunk.sourceType,
      sourceKey: chunk.sourceKey,
      sourceTitle: chunk.sourceTitle,
      content: chunk.content,
      citation: chunk.citation,
      score,
      matchKind: "vector"
    }));
};

const mergeResults = (
  lexicalResults: RetrievalResult[],
  vectorResults: RetrievalResult[],
  limit: number
): RetrievalResult[] => {
  const merged = new Map<string, RetrievalResult>();

  for (const result of [...lexicalResults, ...vectorResults]) {
    const existing = merged.get(result.chunkId);
    if (!existing) {
      merged.set(result.chunkId, result);
      continue;
    }

    merged.set(result.chunkId, {
      ...existing,
      score: Math.max(existing.score, result.score),
      matchKind: existing.matchKind === result.matchKind ? existing.matchKind : "hybrid"
    });
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};

const syncVectorStore = async (
  chunks: StoredChunk[],
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter,
  reporter: ProgressReporter
): Promise<RetrievalSyncSummary> => {
  const compatibleEntries = new Map(
    readCompatibleVectorRows(database, embeddingAdapter).map((entry) => [entry.chunkId, entry])
  );

  let reusedEmbeddings = 0;
  let regeneratedEmbeddings = 0;
  const missingChunks: StoredChunk[] = [];

  for (const chunk of chunks) {
    const existingEntry = compatibleEntries.get(chunk.chunkId);
    if (existingEntry?.contentHash === chunk.contentHash) {
      reusedEmbeddings += 1;
      continue;
    }

    missingChunks.push(chunk);
  }

  reporter.info(
    `Retrieval embedding sync started: chunks=${chunks.length}, reused=${reusedEmbeddings}, remaining=${missingChunks.length}, model=${embeddingAdapter.modelId}.`
  );

  for (let offset = 0; offset < missingChunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = missingChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const embeddings = await embeddingAdapter.embedBatch(batch.map((chunk) => toEmbeddingInput(chunk.content)));

    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding adapter returned ${embeddings.length} vectors for ${batch.length} chunks.`);
    }

    const entries = batch.map((chunk, index) => {
      const embedding = embeddings[index];
      if (!embedding) {
        throw new Error(`Embedding adapter did not return a vector for chunk ${chunk.chunkId}.`);
      }

      return {
        chunkId: chunk.chunkId,
        contentHash: chunk.contentHash,
        embedding
      };
    });

    upsertVectorRows(database, entries, embeddingAdapter);
    regeneratedEmbeddings += entries.length;

    reporter.info(
      `Retrieval embedding sync progress: processed=${reusedEmbeddings + regeneratedEmbeddings}/${chunks.length}, reused=${reusedEmbeddings}, regenerated=${regeneratedEmbeddings}, remaining=${chunks.length - reusedEmbeddings - regeneratedEmbeddings}, failedRetries=${embeddingAdapter.failedRetries ?? 0}, model=${embeddingAdapter.modelId}.`
    );
  }

  return {
    chunkCount: chunks.length,
    reusedEmbeddings,
    regeneratedEmbeddings
  };
};

const deleteStaleVectorRows = (database: Database.Database): void => {
  database.prepare("DELETE FROM chunk_vectors WHERE chunk_id NOT IN (SELECT chunk_id FROM chunks)").run();
};

const readCompatibleVectorRows = (
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter
): StoredVectorEntry[] => {
  const rows = database
    .prepare(
      `SELECT
        chunk_id AS chunkId,
        content_hash AS contentHash,
        embedding_json AS embeddingJson
      FROM chunk_vectors
      WHERE embedding_model_id = ?
        AND embedding_schema_version = ?
      ORDER BY chunk_id`
    )
    .all(embeddingAdapter.modelId, embeddingAdapter.schemaVersion) as Array<{
    chunkId: string;
    contentHash: string;
    embeddingJson: string;
  }>;

  return rows
    .map((row) => {
      const embedding = JSON.parse(row.embeddingJson) as unknown;
      if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
        return null;
      }

      return {
        chunkId: row.chunkId,
        contentHash: row.contentHash,
        embedding
      };
    })
    .filter((entry): entry is StoredVectorEntry => entry !== null);
};

const upsertVectorRows = (
  database: Database.Database,
  entries: VectorIndexEntry[],
  embeddingAdapter: EmbeddingAdapter
): void => {
  if (entries.length === 0) {
    return;
  }

  const upsert = database.prepare(
    `INSERT INTO chunk_vectors (
      chunk_id,
      content_hash,
      embedding_model_id,
      embedding_schema_version,
      embedding_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      embedding_model_id = excluded.embedding_model_id,
      embedding_schema_version = excluded.embedding_schema_version,
      embedding_json = excluded.embedding_json,
      updated_at = excluded.updated_at`
  );

  const now = new Date().toISOString();
  database.transaction(() => {
    for (const entry of entries) {
      upsert.run(
        entry.chunkId,
        entry.contentHash,
        embeddingAdapter.modelId,
        embeddingAdapter.schemaVersion,
        JSON.stringify(entry.embedding),
        now
      );
    }
  })();
};

const importLegacyVectorIndexIfNeeded = async (
  database: Database.Database,
  config: RuntimeConfig,
  embeddingAdapter: EmbeddingAdapter,
  reporter: ProgressReporter
): Promise<void> => {
  const compatibleCount = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM chunk_vectors
       WHERE embedding_model_id = ?
         AND embedding_schema_version = ?`
    )
    .get(embeddingAdapter.modelId, embeddingAdapter.schemaVersion) as { count: number };

  if (compatibleCount.count > 0) {
    return;
  }

  const legacyIndexPath = getVectorIndexPath(config);
  if (!(await fileExists(legacyIndexPath))) {
    return;
  }

  try {
    const imported = await importLegacyVectorIndex(legacyIndexPath, database, embeddingAdapter);
    if (imported > 0) {
      reporter.info(`Imported ${imported} compatible vector embeddings from legacy vector-index.json.`);
    }
  } catch (error) {
    reporter.warn(`Could not import legacy vector-index.json; missing embeddings will be regenerated. ${formatError(error)}`);
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const importLegacyVectorIndex = async (
  indexPath: string,
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter
): Promise<number> => {
  const prefix = await readFilePrefix(indexPath);
  const trimmedPrefix = prefix.trimStart();

  if (trimmedPrefix.startsWith('{"format":"vector-index-ndjson-v1"')) {
    return importLegacyVectorIndexNdjson(indexPath, database, embeddingAdapter);
  }

  return importLegacyVectorIndexJson(indexPath, database, embeddingAdapter);
};

const importLegacyVectorIndexNdjson = async (
  indexPath: string,
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter
): Promise<number> => {
  const input = createInterface({
    input: createReadStream(indexPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header: VectorIndexNdjsonHeader | null = null;
  let imported = 0;
  let batch: VectorIndexEntry[] = [];

  for await (const line of input) {
    if (line.trim().length === 0) {
      continue;
    }

    if (!header) {
      const parsed = JSON.parse(line) as VectorIndexNdjsonHeader;
      if (parsed.format !== "vector-index-ndjson-v1") {
        return 0;
      }
      header = parsed;
      if (!isCompatibleVectorHeader(header, embeddingAdapter)) {
        return 0;
      }
      continue;
    }

    const entry = parseVectorEntry(JSON.parse(line));
    if (!entry) {
      continue;
    }

    batch.push(entry);
    if (batch.length >= VECTOR_IMPORT_BATCH_SIZE) {
      upsertVectorRows(database, batch, embeddingAdapter);
      imported += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    upsertVectorRows(database, batch, embeddingAdapter);
    imported += batch.length;
  }

  return imported;
};

const importLegacyVectorIndexJson = async (
  indexPath: string,
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter
): Promise<number> => {
  const stream = createReadStream(indexPath, { encoding: "utf8" });
  let buffer = "";
  let header: VectorIndexHeader | null = null;
  let state: VectorEntryParseState = {
    objectDepth: 0,
    objectStart: -1,
    inString: false,
    escaped: false
  };
  let imported = 0;
  let batch: VectorIndexEntry[] = [];

  const flushBatch = (): void => {
    if (batch.length === 0) {
      return;
    }

    upsertVectorRows(database, batch, embeddingAdapter);
    imported += batch.length;
    batch = [];
  };

  for await (const chunk of stream) {
    buffer += chunk;

    if (!header) {
      const entriesMarker = buffer.indexOf(',"entries":[');
      if (entriesMarker === -1) {
        continue;
      }

      const parsed = JSON.parse(`${buffer.slice(0, entriesMarker)}}`) as VectorIndexHeader;
      header = {
        embeddingModelId: parsed.embeddingModelId,
        embeddingSchemaVersion: parsed.embeddingSchemaVersion
      };
      if (!isCompatibleVectorHeader(header, embeddingAdapter)) {
        return 0;
      }
      buffer = buffer.slice(entriesMarker + ',"entries":['.length);
    }

    const parsed = parseVectorEntriesFromBuffer(buffer, state, (entry) => {
      batch.push(entry);
      if (batch.length >= VECTOR_IMPORT_BATCH_SIZE) {
        flushBatch();
      }
    });
    buffer = parsed.remaining;
    state = parsed.state;
  }

  flushBatch();
  return imported;
};

const isCompatibleVectorHeader = (header: VectorIndexHeader, embeddingAdapter: EmbeddingAdapter): boolean => {
  return (
    header.embeddingModelId === embeddingAdapter.modelId &&
    header.embeddingSchemaVersion === embeddingAdapter.schemaVersion
  );
};

interface VectorEntryParseState {
  objectDepth: number;
  objectStart: number;
  inString: boolean;
  escaped: boolean;
}

const parseVectorEntriesFromBuffer = (
  buffer: string,
  initialState: VectorEntryParseState,
  onEntry: (entry: VectorIndexEntry) => void
): { remaining: string; state: VectorEntryParseState } => {
  let { escaped, inString, objectDepth, objectStart } = initialState;
  let consumedThrough = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = inString;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      if (objectDepth === 0) {
        objectStart = index;
      }
      objectDepth += 1;
      continue;
    }

    if (character === "}") {
      objectDepth -= 1;
      if (objectDepth === 0 && objectStart >= 0) {
        const entry = parseVectorEntry(JSON.parse(buffer.slice(objectStart, index + 1)));
        if (entry) {
          onEntry(entry);
        }
        consumedThrough = index + 1;
        objectStart = -1;
      }
    }
  }

  const remaining = objectDepth > 0 && objectStart >= 0 ? buffer.slice(objectStart) : buffer.slice(consumedThrough);
  return {
    remaining,
    state: {
      escaped,
      inString,
      objectDepth,
      objectStart: objectDepth > 0 ? 0 : -1
    }
  };
};

const parseVectorEntry = (value: unknown): VectorIndexEntry | null => {
  if (!isRecord(value) || typeof value.chunkId !== "string" || typeof value.contentHash !== "string") {
    return null;
  }

  if (!Array.isArray(value.embedding) || !value.embedding.every((item) => typeof item === "number")) {
    return null;
  }

  return {
    chunkId: value.chunkId,
    contentHash: value.contentHash,
    embedding: value.embedding
  };
};

const readFilePrefix = async (filePath: string, byteCount = 256): Promise<string> => {
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    start: 0,
    end: byteCount - 1
  });
  let prefix = "";

  for await (const chunk of stream) {
    prefix += chunk;
    break;
  }

  return prefix;
};

const buildSqlFilters = (
  request: RetrievalSearchRequest,
  sourceAlias: string
): { sql: string; values: string[] } => {
  const clauses: string[] = [];
  const values: string[] = [];

  if (request.sourceTypes && request.sourceTypes.length > 0) {
    clauses.push(`${sourceAlias}.source_type IN (${request.sourceTypes.map(() => "?").join(", ")})`);
    values.push(...request.sourceTypes);
  }

  if (request.sourceKeys && request.sourceKeys.length > 0) {
    clauses.push(`${sourceAlias}.source_key IN (${request.sourceKeys.map(() => "?").join(", ")})`);
    values.push(...request.sourceKeys);
  }

  return {
    sql: clauses.length === 0 ? "" : ` AND ${clauses.join(" AND ")}`,
    values
  };
};

const matchesRequestFilters = (chunk: StoredChunk, request: RetrievalSearchRequest): boolean => {
  const sourceTypeMatches = !request.sourceTypes || request.sourceTypes.includes(chunk.sourceType);
  const sourceKeyMatches = !request.sourceKeys || request.sourceKeys.includes(chunk.sourceKey);
  return sourceTypeMatches && sourceKeyMatches;
};

const toFtsQuery = (query: string): string | null => {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
};

const hashContent = (content: string): string => {
  return createHash("sha256").update(content).digest("hex");
};

const toEmbeddingInput = (content: string): string => {
  if (content.length <= MAX_EMBEDDING_INPUT_CHARACTERS) {
    return content;
  }

  return content.slice(0, MAX_EMBEDDING_INPUT_CHARACTERS);
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const magnitude = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return magnitude === 0 ? 0 : dot / magnitude;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
