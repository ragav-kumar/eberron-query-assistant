import { mkdir } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import type { CorpusChunk, CorpusSource, RuntimeConfig, SourceType } from "../types.js";

const DATABASE_FILENAME = "corpus.sqlite";

export interface CorpusStore {
  initialize(config: RuntimeConfig): Promise<void>;
  clear(config: RuntimeConfig): Promise<void>;
  replaceSource(config: RuntimeConfig, source: CorpusSource, chunks: CorpusChunk[]): Promise<void>;
  replaceSourcesByType(
    config: RuntimeConfig,
    sourceType: SourceType,
    sources: Array<{ source: CorpusSource; chunks: CorpusChunk[] }>
  ): Promise<void>;
  removeSource(config: RuntimeConfig, sourceType: SourceType, sourceKey: string): Promise<void>;
  removeSourcesByType(config: RuntimeConfig, sourceType: SourceType): Promise<void>;
  countSources(config: RuntimeConfig): Promise<number>;
  close(): void;
}

export const createSqliteCorpusStore = (): CorpusStore => {
  let database: Database.Database | null = null;
  let databasePath: string | null = null;

  const close = (): void => {
    database?.close();
    database = null;
    databasePath = null;
  };

  const open = async (config: RuntimeConfig): Promise<Database.Database> => {
    const nextDatabasePath = getCorpusDatabasePath(config);
    if (database && databasePath === nextDatabasePath) {
      return database;
    }

    close();
    await mkdir(config.retrievalDir, { recursive: true });
    database = new Database(nextDatabasePath);
    databasePath = nextDatabasePath;
    database.pragma("foreign_keys = ON");
    return database;
  };

  return {
    async initialize(config) {
      const openedDatabase = await open(config);
      openedDatabase.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_type, source_key)
      );

      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        citation_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        UNIQUE(source_id, chunk_index)
      );
    `);
    },

    async clear(config) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare("DELETE FROM chunks").run();
        openedDatabase.prepare("DELETE FROM sources").run();
      })();
    },

    async replaceSource(config, source, chunks) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare("DELETE FROM sources WHERE source_type = ? AND source_key = ?").run(source.sourceType, source.sourceKey);
        insertSource(openedDatabase, source, chunks);
      })();
    },

    async replaceSourcesByType(config, sourceType, sources) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare("DELETE FROM sources WHERE source_type = ?").run(sourceType);
        for (const source of sources) {
          insertSource(openedDatabase, source.source, source.chunks);
        }
      })();
    },

    async removeSource(config, sourceType, sourceKey) {
      const openedDatabase = await open(config);
      openedDatabase.prepare("DELETE FROM sources WHERE source_type = ? AND source_key = ?").run(sourceType, sourceKey);
    },

    async removeSourcesByType(config, sourceType) {
      const openedDatabase = await open(config);
      openedDatabase.prepare("DELETE FROM sources WHERE source_type = ?").run(sourceType);
    },

    async countSources(config) {
      const openedDatabase = await open(config);
      const result = openedDatabase.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
      return result.count;
    },

    close
  };
};

const insertSource = (database: Database.Database, source: CorpusSource, chunks: CorpusChunk[]): void => {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO sources (
        source_id,
        source_type,
        source_key,
        title,
        metadata_json,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      source.sourceId,
      source.sourceType,
      source.sourceKey,
      source.title,
      JSON.stringify(source.metadata),
      source.status,
      now,
      now
    );

  const insertChunk = database.prepare(
    `INSERT INTO chunks (
      chunk_id,
      source_id,
      chunk_index,
      text,
      citation_json,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const chunk of chunks) {
    insertChunk.run(
      chunk.chunkId,
      chunk.sourceId,
      chunk.chunkIndex,
      chunk.text,
      JSON.stringify(chunk.citation),
      JSON.stringify(chunk.metadata)
    );
  }
};

export const getCorpusDatabasePath = (config: RuntimeConfig): string => {
  return path.join(config.retrievalDir, DATABASE_FILENAME);
};
