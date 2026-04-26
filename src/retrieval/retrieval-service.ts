import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

interface VectorIndexFile {
  embeddingModelId: string;
  embeddingSchemaVersion: string;
  entries: VectorIndexEntry[];
}

export const createSqliteRetrievalService = (dependencies: RetrievalServiceDependencies): RetrievalService => {
  let config: RuntimeConfig | null = null;
  let vectorIndex: VectorIndexFile | null = null;

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
      rebuildFts(database);
      const chunks = readAllChunks(database);
      const existingIndex = options.forceRebuild ? null : await loadVectorIndex(nextConfig);
      const syncedIndex = await syncVectorIndex(chunks, existingIndex, dependencies.embeddingAdapter);
      vectorIndex = syncedIndex.index;
      await saveVectorIndex(nextConfig, vectorIndex);

      dependencies.reporter.info(
        `Retrieval vector index synchronized: chunks=${syncedIndex.summary.chunkCount}, reused=${syncedIndex.summary.reusedEmbeddings}, regenerated=${syncedIndex.summary.regeneratedEmbeddings}, model=${dependencies.embeddingAdapter.modelId}.`
      );

      return syncedIndex.summary;
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
      const semanticResults = await searchVector(database, request, limit, vectorIndex, dependencies.embeddingAdapter);
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
  index: VectorIndexFile | null,
  embeddingAdapter: EmbeddingAdapter
): Promise<RetrievalResult[]> => {
  if (
    !index ||
    index.embeddingModelId !== embeddingAdapter.modelId ||
    index.embeddingSchemaVersion !== embeddingAdapter.schemaVersion
  ) {
    return [];
  }

  const chunks = readAllChunks(database).filter((chunk) => matchesRequestFilters(chunk, request));
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const queryEmbedding = await embeddingAdapter.embed(request.query);

  return index.entries
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

const syncVectorIndex = async (
  chunks: StoredChunk[],
  existingIndex: VectorIndexFile | null,
  embeddingAdapter: EmbeddingAdapter
): Promise<{ index: VectorIndexFile; summary: RetrievalSyncSummary }> => {
  const compatibleEntries =
    existingIndex?.embeddingModelId === embeddingAdapter.modelId &&
    existingIndex.embeddingSchemaVersion === embeddingAdapter.schemaVersion
      ? new Map(existingIndex.entries.map((entry) => [entry.chunkId, entry]))
      : new Map<string, VectorIndexEntry>();

  let reusedEmbeddings = 0;
  let regeneratedEmbeddings = 0;
  const entries: VectorIndexEntry[] = [];

  for (const chunk of chunks) {
    const existingEntry = compatibleEntries.get(chunk.chunkId);
    if (existingEntry?.contentHash === chunk.contentHash) {
      entries.push(existingEntry);
      reusedEmbeddings += 1;
      continue;
    }

    entries.push({
      chunkId: chunk.chunkId,
      contentHash: chunk.contentHash,
      embedding: await embeddingAdapter.embed(chunk.content)
    });
    regeneratedEmbeddings += 1;
  }

  return {
    index: {
      embeddingModelId: embeddingAdapter.modelId,
      embeddingSchemaVersion: embeddingAdapter.schemaVersion,
      entries
    },
    summary: {
      chunkCount: chunks.length,
      reusedEmbeddings,
      regeneratedEmbeddings
    }
  };
};

const loadVectorIndex = async (config: RuntimeConfig): Promise<VectorIndexFile | null> => {
  try {
    const raw = await readFile(getVectorIndexPath(config), "utf8");
    const parsed = JSON.parse(raw) as VectorIndexFile;
    if (!Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const saveVectorIndex = async (config: RuntimeConfig, index: VectorIndexFile): Promise<void> => {
  await mkdir(config.retrievalDir, { recursive: true });
  await writeFile(getVectorIndexPath(config), `${JSON.stringify(index, null, 2)}\n`, "utf8");
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
