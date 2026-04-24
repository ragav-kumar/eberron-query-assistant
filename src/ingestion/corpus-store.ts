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

export class SqliteCorpusStore implements CorpusStore {
  private database: Database.Database | null = null;
  private databasePath: string | null = null;

  async initialize(config: RuntimeConfig): Promise<void> {
    const database = await this.open(config);
    database.exec(`
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
  }

  async clear(config: RuntimeConfig): Promise<void> {
    const database = await this.open(config);
    database.transaction(() => {
      database.prepare("DELETE FROM chunks").run();
      database.prepare("DELETE FROM sources").run();
    })();
  }

  async replaceSource(config: RuntimeConfig, source: CorpusSource, chunks: CorpusChunk[]): Promise<void> {
    const database = await this.open(config);
    database.transaction(() => {
      database.prepare("DELETE FROM sources WHERE source_type = ? AND source_key = ?").run(source.sourceType, source.sourceKey);
      insertSource(database, source, chunks);
    })();
  }

  async replaceSourcesByType(
    config: RuntimeConfig,
    sourceType: SourceType,
    sources: Array<{ source: CorpusSource; chunks: CorpusChunk[] }>
  ): Promise<void> {
    const database = await this.open(config);
    database.transaction(() => {
      database.prepare("DELETE FROM sources WHERE source_type = ?").run(sourceType);
      for (const source of sources) {
        insertSource(database, source.source, source.chunks);
      }
    })();
  }

  async removeSource(config: RuntimeConfig, sourceType: SourceType, sourceKey: string): Promise<void> {
    const database = await this.open(config);
    database.prepare("DELETE FROM sources WHERE source_type = ? AND source_key = ?").run(sourceType, sourceKey);
  }

  async removeSourcesByType(config: RuntimeConfig, sourceType: SourceType): Promise<void> {
    const database = await this.open(config);
    database.prepare("DELETE FROM sources WHERE source_type = ?").run(sourceType);
  }

  async countSources(config: RuntimeConfig): Promise<number> {
    const database = await this.open(config);
    const result = database.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    return result.count;
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.databasePath = null;
  }

  private async open(config: RuntimeConfig): Promise<Database.Database> {
    const databasePath = getCorpusDatabasePath(config);
    if (this.database && this.databasePath === databasePath) {
      return this.database;
    }

    this.close();
    await mkdir(config.retrievalDir, { recursive: true });
    this.database = new Database(databasePath);
    this.databasePath = databasePath;
    this.database.pragma("foreign_keys = ON");
    return this.database;
  }
}

function insertSource(database: Database.Database, source: CorpusSource, chunks: CorpusChunk[]): void {
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
}

export function getCorpusDatabasePath(config: RuntimeConfig): string {
  return path.join(config.retrievalDir, DATABASE_FILENAME);
}
