import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import { createTaggedError } from '@/errors.js';
import type { CorpusChunk, CorpusSource, RuntimeConfig, SourceType } from '@/types.js';

const DATABASE_FILENAME = 'corpus.sqlite';

export interface CorpusStore {
  initialize(config: RuntimeConfig, options?: { allowIncompatibleReset?: boolean }): Promise<void>;
  applySourceChanges(
    config: RuntimeConfig,
    options: {
      clearSourceType?: SourceType;
      changes: Array<
        | { kind: 'delete'; sourceKey: string; sourceType: SourceType }
        | { kind: 'upsert'; source: CorpusSource; chunks: CorpusChunk[] }
      >;
    }
  ): Promise<void>;
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
  rebuildSearchIndex(config: RuntimeConfig): Promise<void>;
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
    database.pragma('foreign_keys = ON');
    return database;
  };

  return {
    async initialize(config, options = {}) {
      let openedDatabase = await open(config);
      if (!isCompatibleSchema(openedDatabase)) {
        if (options.allowIncompatibleReset !== true) {
          throw createTaggedError(
            'incompatible-corpus-schema',
            'Existing corpus.sqlite is not compatible with the current corpus schema. Use the browser force-reingest control to rebuild retrieval artifacts explicitly.'
          );
        }
        close();
        await rm(nextDatabasePath(config), { force: true });
        openedDatabase = await open(config);
      }

      createSchema(openedDatabase);
    },

    async applySourceChanges(config, options) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        if (options.clearSourceType) {
          openedDatabase.prepare('DELETE FROM sources WHERE source_type = ?').run(options.clearSourceType);
        }
        for (const change of options.changes) {
          if (change.kind === 'delete') {
            openedDatabase.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(
              change.sourceType,
              change.sourceKey
            );
          } else {
            openedDatabase.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(
              change.source.sourceType,
              change.source.sourceKey
            );
            insertSource(openedDatabase, change.source, change.chunks);
          }
        }
        rebuildFts(openedDatabase);
      })();
    },

    async clear(config) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare('DELETE FROM chunks').run();
        openedDatabase.prepare('DELETE FROM sources').run();
        rebuildFts(openedDatabase);
      })();
    },

    async replaceSource(config, source, chunks) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(source.sourceType, source.sourceKey);
        insertSource(openedDatabase, source, chunks);
        rebuildFts(openedDatabase);
      })();
    },

    async replaceSourcesByType(config, sourceType, sources) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
        for (const source of sources) {
          insertSource(openedDatabase, source.source, source.chunks);
        }
        rebuildFts(openedDatabase);
      })();
    },

    async removeSource(config, sourceType, sourceKey) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(sourceType, sourceKey);
        rebuildFts(openedDatabase);
      })();
    },

    async removeSourcesByType(config, sourceType) {
      const openedDatabase = await open(config);
      openedDatabase.transaction(() => {
        openedDatabase.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
        rebuildFts(openedDatabase);
      })();
    },

    async countSources(config) {
      const openedDatabase = await open(config);
      const result = openedDatabase.prepare('SELECT COUNT(*) AS count FROM sources').get() as { count: number };
      return result.count;
    },

    async rebuildSearchIndex(config) {
      const openedDatabase = await open(config);
      rebuildFts(openedDatabase);
    },

    close
  };
};

const createSchema = (database: Database.Database): void => {
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

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        content='chunks',
        content_rowid='rowid'
      );
    `);

  rebuildFts(database);
};

const rebuildFts = (database: Database.Database): void => {
  database.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')").run();
};

const isCompatibleSchema = (database: Database.Database): boolean => {
  const sourceColumns = readColumnNames(database, 'sources');
  const chunkColumns = readColumnNames(database, 'chunks');
  if (sourceColumns.length === 0 && chunkColumns.length === 0) {
    return true;
  }

  return hasColumns(sourceColumns, ['source_id', 'source_type', 'source_key', 'title', 'metadata_json', 'status']) &&
    hasColumns(chunkColumns, ['chunk_id', 'source_id', 'chunk_index', 'text', 'citation_json', 'metadata_json']);
};

const readColumnNames = (database: Database.Database, tableName: string): string[] => database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => (row as { name: string }).name);

const hasColumns = (actual: string[], expected: string[]): boolean => expected.every((column) => actual.includes(column));

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

export const getCorpusDatabasePath = (config: RuntimeConfig): string => nextDatabasePath(config);

const nextDatabasePath = (config: RuntimeConfig): string => path.join(config.retrievalDir, DATABASE_FILENAME);
