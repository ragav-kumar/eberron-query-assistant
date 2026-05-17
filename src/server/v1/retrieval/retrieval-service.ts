import { createHash } from 'node:crypto';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import { throwIfAborted } from '@/errors.js';
import { getCorpusDatabasePath } from '../ingestion/index.js';
import type { EmbeddingAdapter } from '../provider/index.js';
import type { ProgressReporter } from '../progress/reporter.js';
import { createNoopTimingReporter } from '@/timing.js';
import type {
  CitationMetadata,
  RetrievalResult,
  RetrievalSearchRequest,
  RuntimeConfig,
  SourceType
} from '@/types.js';

const VECTOR_INDEX_FILENAME = 'vector-index.json';
const DEFAULT_LIMIT = 8;
const EMBEDDING_BATCH_SIZE = 64;
const REFRESH_CHUNK_BATCH_SIZE = 256;
const VECTOR_SCAN_BATCH_SIZE = 256;
const MAX_VECTOR_CACHE_DATABASE_BYTES = 256 * 1024 * 1024;
const MAX_EMBEDDING_INPUT_CHARACTERS = 6_000;
const VECTOR_STORE_SCHEMA_VERSION = 'sqlite-json-v1';

export interface RetrievalSyncSummary {
  chunkCount: number;
  reusedEmbeddings: number;
  regeneratedEmbeddings: number;
}

export interface RetrievalService {
  prepare(config: RuntimeConfig): Promise<void>;
  refresh(config: RuntimeConfig, options?: { abortSignal?: AbortSignal; forceRebuild?: boolean }): Promise<RetrievalSyncSummary>;
  search(request: RetrievalSearchRequest): Promise<RetrievalResult[]>;
}

export interface RetrievalServiceDependencies {
  embeddingAdapter: EmbeddingAdapter;
  maxVectorCacheDatabaseBytes?: number;
  reporter: ProgressReporter;
}

interface StoredChunk {
  chunkId: string;
  rowId: number;
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

interface StoredVectorEntry {
  chunkId: string;
  contentHash: string;
  embedding: number[];
}

interface VectorCacheEntry {
  dbPath: string;
  embeddingModelId: string;
  embeddingSchemaVersion: string;
  entries: StoredVectorEntry[];
}

interface EmbeddingChunk {
  chunkId: string;
  content: string;
  contentHash: string;
  rowId: number;
}

interface VectorCandidateRow {
  rowId: number;
  chunkId: string;
  sourceId: string;
  sourceType: SourceType;
  sourceKey: string;
  sourceTitle: string;
  content: string;
  citationJson: string;
  contentHash: string;
  embeddingJson: string;
}

export const createSqliteRetrievalService = (dependencies: RetrievalServiceDependencies): RetrievalService => {
  let config: RuntimeConfig | null = null;
  let shouldCacheVectorRows = true;
  let vectorCache: VectorCacheEntry | null = null;
  const vectorCacheByteLimit = dependencies.maxVectorCacheDatabaseBytes ?? MAX_VECTOR_CACHE_DATABASE_BYTES;

  const openDatabase = (): Database.Database => {
    if (!config) {
      throw new Error('Retrieval service must be refreshed before search.');
    }

    return new Database(getCorpusDatabasePath(config), { readonly: true });
  };

  const refresh = async (
    nextConfig: RuntimeConfig,
    options: { abortSignal?: AbortSignal; forceRebuild?: boolean } = {}
  ): Promise<RetrievalSyncSummary> => {
    await prepare(nextConfig);
    throwIfAborted(options.abortSignal);
    if (options.forceRebuild) {
      await deleteLegacyVectorIndex(nextConfig, dependencies.reporter);
    }

    const database = new Database(getCorpusDatabasePath(nextConfig));
    try {
      database.pragma('foreign_keys = ON');
      throwIfAborted(options.abortSignal);
      rebuildFts(database);
      initializeVectorStore(database);

      if (options.forceRebuild) {
        database.prepare('DELETE FROM chunk_vectors').run();
      }

      deleteStaleVectorRows(database);
      const summary = await syncVectorStore(database, dependencies.embeddingAdapter, dependencies.reporter, options.abortSignal);

      dependencies.reporter.info(
        `Retrieval vector index synchronized: chunks=${summary.chunkCount}, reused=${summary.reusedEmbeddings}, regenerated=${summary.regeneratedEmbeddings}, model=${dependencies.embeddingAdapter.modelId}.`
      );
      if (!shouldCacheVectorRows) {
        dependencies.reporter.info(
          'Retrieval vector cache disabled for large corpus database; searches will stream vectors directly from SQLite.'
        );
      }

      return summary;
    } finally {
      database.close();
    }
  };

  const prepare = async (nextConfig: RuntimeConfig): Promise<void> => {
    config = nextConfig;
    await mkdir(nextConfig.retrievalDir, { recursive: true });
    shouldCacheVectorRows = await shouldUseVectorCache(nextConfig, vectorCacheByteLimit);
    vectorCache = null;
  };

  const search = async (request: RetrievalSearchRequest): Promise<RetrievalResult[]> => {
    const limit = request.limit ?? DEFAULT_LIMIT;
    if (request.query.trim().length === 0 || limit <= 0) {
      return [];
    }

    const database = openDatabase();
    const timing = request.timing ?? {
      operation: 'retrieval',
      operationId: 'untracked',
      reporter: createNoopTimingReporter()
    };

    try {
      const lexicalResults = await timing.reporter.time(timing, 'retrieval.lexical', () =>
        searchLexical(database, request, limit)
      );
      if (!shouldCacheVectorRows && lexicalResults.length > 0) {
        dependencies.reporter.info(
          `Large corpus retrieval is using lexical matches only for this query; skipping full semantic vector scan. lexicalResults=${lexicalResults.length}, limit=${limit}.`
        );
        return lexicalResults;
      }

      if (!shouldCacheVectorRows) {
        dependencies.reporter.info(
          'Large corpus retrieval found no lexical matches; starting direct semantic vector scan from SQLite.'
        );
      }

      const semanticResults = await timing.reporter.time(timing, 'retrieval.vector', () =>
        searchVector(database, request, limit, dependencies.embeddingAdapter, {
          canCache() {
            return shouldCacheVectorRows;
          },
          read() {
            return readCachedVectorRows(vectorCache, config, dependencies.embeddingAdapter);
          },
          write(entries) {
            if (!config) {
              return;
            }
            vectorCache = {
              ...createVectorCacheKey(config, dependencies.embeddingAdapter),
              entries
            };
          }
        })
      );

      return await timing.reporter.time(timing, 'retrieval.merge', () =>
        mergeResults(lexicalResults, semanticResults, limit)
      );
    } finally {
      database.close();
    }
  };

  return {
    prepare,
    refresh,
    search
  };
};

export const getVectorIndexPath = (config: RuntimeConfig): string => {
  return path.join(config.retrievalDir, VECTOR_INDEX_FILENAME);
};

const deleteLegacyVectorIndex = async (config: RuntimeConfig, reporter: ProgressReporter): Promise<void> => {
  const legacyIndexPath = getVectorIndexPath(config);
  if (!(await fileExists(legacyIndexPath))) {
    return;
  }

  await rm(legacyIndexPath, { force: true });
  reporter.info('Deleted legacy vector-index.json; missing embeddings will be regenerated into SQLite.');
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

const readFilteredChunks = (database: Database.Database, request: RetrievalSearchRequest): StoredChunk[] => {
  const filters = buildSqlFilters(request, 's');

  return (
    database
      .prepare(
        `SELECT
          c.rowid AS rowId,
          c.chunk_id AS chunkId,
          c.source_id AS sourceId,
          c.text AS content,
          c.citation_json AS citationJson,
          s.source_type AS sourceType,
          s.source_key AS sourceKey,
          s.title AS sourceTitle
        FROM chunks c
        INNER JOIN sources s ON s.source_id = c.source_id
        WHERE 1 = 1${filters.sql}
        ORDER BY c.rowid`
      )
      .all(...filters.values) as Array<{
      rowId: number;
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
    rowId: row.rowId,
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

  const filters = buildSqlFilters(request, 's');
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
    matchKind: 'lexical'
  }));
};

const searchVector = async (
  database: Database.Database,
  request: RetrievalSearchRequest,
  limit: number,
  embeddingAdapter: EmbeddingAdapter,
  vectorCache: {
    canCache(): boolean;
    read(): StoredVectorEntry[] | null;
    write(entries: StoredVectorEntry[]): void;
  }
): Promise<RetrievalResult[]> => {
  const timing = request.timing ?? {
    operation: 'retrieval',
    operationId: 'untracked',
    reporter: createNoopTimingReporter()
  };

  const queryEmbedding = await timing.reporter.time(timing, 'retrieval.vector.embed_query', () =>
    embeddingAdapter.embed(toEmbeddingInput(request.query))
  );

  if (!vectorCache.canCache()) {
    return timing.reporter.time(timing, 'retrieval.vector.stream_vectors', () =>
      searchVectorStreaming(database, request, limit, embeddingAdapter, queryEmbedding)
    );
  }

  const chunks = await timing.reporter.time(timing, 'retrieval.vector.read_chunks', () =>
    readFilteredChunks(database, request)
  );
  if (chunks.length === 0) {
    return [];
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const compatibleRows = await timing.reporter.time(timing, 'retrieval.vector.read_vectors', () => {
    const cachedRows = vectorCache.read();
    if (cachedRows) {
      return cachedRows;
    }

    const rows = readCompatibleVectorRows(database, embeddingAdapter);
    vectorCache.write(rows);
    return rows;
  });

  return timing.reporter.time(timing, 'retrieval.vector.score_sort', () =>
    scoreVectorEntries(chunkById, compatibleRows, queryEmbedding, limit)
  );
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
      matchKind: existing.matchKind === result.matchKind ? existing.matchKind : 'hybrid'
    });
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
};

const syncVectorStore = async (
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter,
  reporter: ProgressReporter,
  abortSignal?: AbortSignal
): Promise<RetrievalSyncSummary> => {
  throwIfAborted(abortSignal);
  const chunkCount = countChunks(database);
  let reusedEmbeddings = 0;
  let regeneratedEmbeddings = 0;

  reporter.info(
    `Retrieval embedding sync started: chunks=${chunkCount}, reused=0, remaining=${chunkCount}, model=${embeddingAdapter.modelId}.`
  );

  let lastRowId = 0;
  let processedChunks = 0;
  while (true) {
    throwIfAborted(abortSignal);
    const chunkBatch = readChunkEmbeddingBatch(database, lastRowId, REFRESH_CHUNK_BATCH_SIZE);
    if (chunkBatch.length === 0) {
      break;
    }

    const compatibleEntries = new Map(
      readCompatibleVectorRowsForChunkIds(
        database,
        embeddingAdapter,
        chunkBatch.map((chunk) => chunk.chunkId)
      ).map((entry) => [entry.chunkId, entry])
    );
    const missingChunks = chunkBatch.filter((chunk) => {
      const existingEntry = compatibleEntries.get(chunk.chunkId);
      if (existingEntry?.contentHash === chunk.contentHash) {
        reusedEmbeddings += 1;
        return false;
      }

      return true;
    });

    for (let offset = 0; offset < missingChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      throwIfAborted(abortSignal);
      const embeddingBatch = missingChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embeddings = await embeddingAdapter.embedBatch(embeddingBatch.map((chunk) => toEmbeddingInput(chunk.content)));
      throwIfAborted(abortSignal);

      if (embeddings.length !== embeddingBatch.length) {
        throw new Error(`Embedding adapter returned ${embeddings.length} vectors for ${embeddingBatch.length} chunks.`);
      }

      const entries = embeddingBatch.map((chunk, index) => {
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
    }

    processedChunks += chunkBatch.length;
    lastRowId = chunkBatch[chunkBatch.length - 1]?.rowId ?? lastRowId;
    reportProgress(
      reporter,
      `Retrieval embedding sync progress: processed=${processedChunks}/${chunkCount}, reused=${reusedEmbeddings}, regenerated=${regeneratedEmbeddings}, remaining=${chunkCount - processedChunks}, failedRetries=${embeddingAdapter.failedRetries ?? 0}, model=${embeddingAdapter.modelId}.`
    );
  }

  return {
    chunkCount,
    reusedEmbeddings,
    regeneratedEmbeddings
  };
};

const reportProgress = (reporter: ProgressReporter, message: string): void => {
  if (reporter.progress) {
    reporter.progress(message);
    return;
  }

  reporter.info(message);
};

const deleteStaleVectorRows = (database: Database.Database): void => {
  database.prepare('DELETE FROM chunk_vectors WHERE chunk_id NOT IN (SELECT chunk_id FROM chunks)').run();
};

const countChunks = (database: Database.Database): number => {
  const result = database.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number };
  return result.count;
};

const readChunkEmbeddingBatch = (
  database: Database.Database,
  afterRowId: number,
  limit: number
): EmbeddingChunk[] => {
  const rows = database
    .prepare(
      `SELECT
        rowid AS rowId,
        chunk_id AS chunkId,
        text AS content
      FROM chunks
      WHERE rowid > ?
      ORDER BY rowid
      LIMIT ?`
    )
    .all(afterRowId, limit) as Array<{
    rowId: number;
    chunkId: string;
    content: string;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    content: row.content,
    contentHash: hashContent(row.content),
    rowId: row.rowId
  }));
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
      const embedding = parseEmbedding(row.embeddingJson);
      if (!embedding) {
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

const readCompatibleVectorRowsForChunkIds = (
  database: Database.Database,
  embeddingAdapter: EmbeddingAdapter,
  chunkIds: string[]
): StoredVectorEntry[] => {
  if (chunkIds.length === 0) {
    return [];
  }

  const rows = database
    .prepare(
      `SELECT
        chunk_id AS chunkId,
        content_hash AS contentHash,
        embedding_json AS embeddingJson
      FROM chunk_vectors
      WHERE embedding_model_id = ?
        AND embedding_schema_version = ?
        AND chunk_id IN (${chunkIds.map(() => '?').join(', ')})`
    )
    .all(embeddingAdapter.modelId, embeddingAdapter.schemaVersion, ...chunkIds) as Array<{
    chunkId: string;
    contentHash: string;
    embeddingJson: string;
  }>;

  return rows
    .map((row) => {
      const embedding = parseEmbedding(row.embeddingJson);
      if (!embedding) {
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

const searchVectorStreaming = (
  database: Database.Database,
  request: RetrievalSearchRequest,
  limit: number,
  embeddingAdapter: EmbeddingAdapter,
  queryEmbedding: number[]
): Promise<RetrievalResult[]> => {
  const filters = buildSqlFilters(request, 's');
  const results: RetrievalResult[] = [];
  let lastRowId = 0;

  while (true) {
    const rows = database
      .prepare(
        `SELECT
          c.rowid AS rowId,
          c.chunk_id AS chunkId,
          c.source_id AS sourceId,
          c.text AS content,
          c.citation_json AS citationJson,
          s.source_type AS sourceType,
          s.source_key AS sourceKey,
          s.title AS sourceTitle,
          cv.content_hash AS contentHash,
          cv.embedding_json AS embeddingJson
        FROM chunk_vectors cv
        INNER JOIN chunks c ON c.chunk_id = cv.chunk_id
        INNER JOIN sources s ON s.source_id = c.source_id
        WHERE cv.embedding_model_id = ?
          AND cv.embedding_schema_version = ?
          AND c.rowid > ?${filters.sql}
        ORDER BY c.rowid
        LIMIT ?`
      )
      .all(
        embeddingAdapter.modelId,
        embeddingAdapter.schemaVersion,
        lastRowId,
        ...filters.values,
        VECTOR_SCAN_BATCH_SIZE
      ) as VectorCandidateRow[];
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const embedding = parseEmbedding(row.embeddingJson);
      if (!embedding || row.contentHash !== hashContent(row.content)) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score <= 0) {
        continue;
      }

      insertSortedResult(
        results,
        {
          chunkId: row.chunkId,
          sourceId: row.sourceId,
          sourceType: row.sourceType,
          sourceKey: row.sourceKey,
          sourceTitle: row.sourceTitle,
          content: row.content,
          citation: JSON.parse(row.citationJson) as CitationMetadata,
          score,
          matchKind: 'vector'
        },
        limit
      );
    }

    lastRowId = rows[rows.length - 1]?.rowId ?? lastRowId;
  }

  return Promise.resolve(results);
};

const scoreVectorEntries = (
  chunkById: Map<string, StoredChunk>,
  vectorEntries: StoredVectorEntry[],
  queryEmbedding: number[],
  limit: number
): RetrievalResult[] => {
  return vectorEntries
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
      matchKind: 'vector'
    }));
};

const insertSortedResult = (results: RetrievalResult[], result: RetrievalResult, limit: number): void => {
  let insertAt = results.findIndex((existing) => result.score > existing.score);
  if (insertAt === -1) {
    insertAt = results.length;
  }

  if (results.length >= limit && insertAt >= results.length) {
    return;
  }

  results.splice(insertAt, 0, result);
  if (results.length > limit) {
    results.length = limit;
  }
};

const parseEmbedding = (embeddingJson: string): number[] | null => {
  try {
    const embedding = JSON.parse(embeddingJson) as unknown;
    return Array.isArray(embedding) && embedding.every((value) => typeof value === 'number') ? embedding : null;
  } catch {
    return null;
  }
};

const createVectorCacheKey = (
  config: RuntimeConfig,
  embeddingAdapter: EmbeddingAdapter
): Omit<VectorCacheEntry, 'entries'> => ({
  dbPath: getCorpusDatabasePath(config),
  embeddingModelId: embeddingAdapter.modelId,
  embeddingSchemaVersion: embeddingAdapter.schemaVersion
});

const readCachedVectorRows = (
  cache: VectorCacheEntry | null,
  config: RuntimeConfig | null,
  embeddingAdapter: EmbeddingAdapter
): StoredVectorEntry[] | null => {
  if (!cache || !config) {
    return null;
  }

  const key = createVectorCacheKey(config, embeddingAdapter);
  return cache.dbPath === key.dbPath &&
    cache.embeddingModelId === key.embeddingModelId &&
    cache.embeddingSchemaVersion === key.embeddingSchemaVersion
    ? cache.entries
    : null;
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

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const buildSqlFilters = (
  request: RetrievalSearchRequest,
  sourceAlias: string
): { sql: string; values: string[] } => {
  const clauses: string[] = [];
  const values: string[] = [];

  if (request.sourceTypes && request.sourceTypes.length > 0) {
    clauses.push(`${sourceAlias}.source_type IN (${request.sourceTypes.map(() => '?').join(', ')})`);
    values.push(...request.sourceTypes);
  }

  if (request.sourceKeys && request.sourceKeys.length > 0) {
    clauses.push(`${sourceAlias}.source_key IN (${request.sourceKeys.map(() => '?').join(', ')})`);
    values.push(...request.sourceKeys);
  }

  return {
    sql: clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`,
    values
  };
};

const toFtsQuery = (query: string): string | null => {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
};

const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
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

const shouldUseVectorCache = async (config: RuntimeConfig, maxDatabaseBytes: number): Promise<boolean> => {
  if (maxDatabaseBytes <= 0) {
    return false;
  }

  try {
    const databaseStats = await stat(getCorpusDatabasePath(config));
    return databaseStats.size <= maxDatabaseBytes;
  } catch {
    return false;
  }
};
