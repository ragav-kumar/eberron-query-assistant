import Database from 'better-sqlite3';

/**
 * Ensures the baseline corpus schema exists in the corpus database.
 *
 * This creates the durable source and chunk tables plus the FTS table used for
 * lexical retrieval. It is safe to call multiple times and is intended to run
 * during corpus-store initialization before any read or write workloads begin.
 */
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

    // Additive migration: add content_hash column to chunks for existing databases.
    // CREATE TABLE above uses IF NOT EXISTS, so this ALTER TABLE handles pre-existing installations.
    try {
        database.prepare('ALTER TABLE chunks ADD COLUMN content_hash TEXT').run();
    } catch {
        // Column already exists — safe to ignore.
    }

    rebuildCorpusFts(database);
};

/**
 * Rebuilds the full-text index from the current `chunks` table contents.
 *
 * Call this after bulk source mutations or any sequence of writes that changes
 * chunk text. The store methods in this folder already do this for their public
 * mutations, so external callers normally should not need to trigger it.
 */
export const rebuildCorpusFts = (database: Database.Database): void => {
    database.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')").run();
};

/**
 * Checks whether an existing on-disk corpus schema is compatible with this
 * boundary's expected `sources` and `chunks` layout.
 *
 * This is intentionally conservative: callers use it to decide whether routine
 * startup may proceed or whether the user must opt into an explicit rebuild.
 */
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
