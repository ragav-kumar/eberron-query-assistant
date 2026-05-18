import Database from 'better-sqlite3';

export const createCorpusSchema = (database: Database.Database): void => {
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

    rebuildCorpusFts(database);
};

export const rebuildCorpusFts = (database: Database.Database): void => {
    database.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')").run();
};

export const isCompatibleCorpusSchema = (database: Database.Database): boolean => {
    const sourceColumns = readColumnNames(database, 'sources');
    const chunkColumns = readColumnNames(database, 'chunks');
    if (sourceColumns.length === 0 && chunkColumns.length === 0) {
        return true;
    }

    return hasColumns(sourceColumns, ['source_id', 'source_type', 'source_key', 'title', 'metadata_json', 'status']) &&
        hasColumns(chunkColumns, ['chunk_id', 'source_id', 'chunk_index', 'text', 'citation_json', 'metadata_json']);
};

const readColumnNames = (database: Database.Database, tableName: string): string[] => (
    database.prepare(`PRAGMA table_info(${tableName})`).all().map(row => (row as { name: string }).name)
);

const hasColumns = (actual: string[], expected: string[]): boolean => expected.every(column => actual.includes(column));
