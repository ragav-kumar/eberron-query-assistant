import { rm } from 'node:fs/promises';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { createTaggedError } from '../../../errors.js';
import type { CorpusChunk, CorpusSource, SourceType } from '../../../types.js';

import { createCorpusDatabase, getCorpusDatabasePath } from './database.js';
import { createCorpusSchema, isCompatibleCorpusSchema, rebuildCorpusFts } from './schema.js';

/**
 * Write-side API for maintaining the durable retrieval corpus.
 *
 * Use this from ingestion and refresh flows that need to initialize the corpus
 * database, upsert or delete sources, clear source groups, or rebuild lexical
 * search state. This is the main abstraction that should gate write access to
 * the corpus database.
 *
 * Call pattern:
 * 1. `initialize(config)` before first use for a given runtime dir
 * 2. apply one of the mutation methods during refresh/reingest work
 * 3. `close()` when the owning app or test fixture is shutting down
 */
export interface CorpusStore {
    /**
     * Applies a mixed batch of deletions and upserts in one transaction.
     *
     * Use this for refresh flows that have already computed a set of source
     * changes and want one atomic write with a single FTS rebuild.
     */
    applySourceChanges(
        retrievalDir: string,
        options: {
            changes: Array<
                | { kind: 'delete'; sourceKey: string; sourceType: SourceType }
                | { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource }
            >;
            clearSourceType?: SourceType;
        },
    ): Promise<void>;

    /**
     * Deletes all sources and chunks from the corpus.
     *
     * Reserve this for explicit rebuild flows. Routine refresh should prefer
     * scoped mutations so durable state is preserved wherever possible.
     */
    clear(retrievalDir: string): Promise<void>;

    /**
     * Releases the cached writable SQLite handle.
     *
     * Always call this during teardown or before removing the on-disk database.
     */
    close(): void;

    /**
     * Returns the current number of source rows in the corpus.
     *
     * Useful for diagnostics, tests, and refresh decisions that need a cheap
     * corpus-population signal.
     */
    countSources(retrievalDir: string): Promise<number>;

    /**
     * Creates the corpus schema if needed and validates schema compatibility.
     *
     * By default this throws an `incompatible-corpus-schema` tagged error when
     * an existing database does not match the expected layout. Pass
     * `allowIncompatibleReset: true` only in explicit rebuild flows where it is
     * acceptable to discard and recreate the database file.
     */
    initialize(retrievalDir: string, options?: { allowIncompatibleReset?: boolean }): Promise<void>;

    /**
     * Forces a full lexical-index rebuild from the stored chunks.
     *
     * The public mutation methods already do this themselves. This hook exists
     * for recovery or migration cases where the caller needs to repair FTS state
     * without changing source rows.
     */
    rebuildSearchIndex(retrievalDir: string): Promise<void>;

    /** Deletes exactly one source row, keyed by source type and source key. */
    removeSource(retrievalDir: string, sourceType: SourceType, sourceKey: string): Promise<void>;

    /**
     * Deletes every source of a given type.
     *
     * This is appropriate for explicit source-scope rebuilds such as replaying
     * one source family from discovery results or export history.
     */
    removeSourcesByType(retrievalDir: string, sourceType: SourceType): Promise<void>;

    /**
     * Replaces one source and all of its chunks atomically.
     *
     * This is the simplest mutation for callers that already have a complete
     * source payload ready to persist.
     */
    replaceSource(retrievalDir: string, source: CorpusSource, chunks: CorpusChunk[]): Promise<void>;

    /**
     * Replaces the full set of sources for a source type atomically.
     *
     * Use this when the caller has recomputed the full canonical set for a
     * source family and wants the corpus to match it exactly.
     */
    replaceSourcesByType(
        retrievalDir: string,
        sourceType: SourceType,
        sources: Array<{ chunks: CorpusChunk[]; source: CorpusSource }>,
    ): Promise<void>;
}

/**
 * Creates the default write-side corpus gateway.
 *
 * External code should prefer this over direct SQLite access whenever it needs
 * to mutate the corpus database. The implementation preserves the current
 * on-disk schema and FTS behavior while keeping one folder that clearly owns
 * corpus writes.
 */
export const createCorpusStore = (): CorpusStore => {
    const corpusDatabase = createCorpusDatabase();

    return {
        initialize: async (retrievalDir, options = {}) => {
            let database = await corpusDatabase.open(retrievalDir);
            if (!isCompatibleCorpusSchema(database)) {
                if (options.allowIncompatibleReset !== true) {
                    throw createTaggedError(
                        'incompatible-corpus-schema',
                        'Existing corpus.sqlite is not compatible with the current corpus schema. Use the browser force-reingest control to rebuild retrieval artifacts explicitly.',
                    );
                }
                corpusDatabase.close();
                await rm(getCorpusDatabasePath(retrievalDir), { force: true });
                database = await corpusDatabase.open(retrievalDir);
            }

            createCorpusSchema(database);
        },

        applySourceChanges: async (retrievalDir, options) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                if (options.clearSourceType) {
                    database.prepare('DELETE FROM sources WHERE source_type = ?').run(options.clearSourceType);
                }
                for (const change of options.changes) {
                    if (change.kind === 'delete') {
                        database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(
                            change.sourceType,
                            change.sourceKey,
                        );
                    } else {
                        database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(
                            change.source.sourceType,
                            change.source.sourceKey,
                        );
                        insertSource(database, change.source, change.chunks);
                    }
                }
                rebuildCorpusFts(database);
            })();
        },

        clear: async (retrievalDir) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                database.prepare('DELETE FROM chunks').run();
                database.prepare('DELETE FROM sources').run();
                rebuildCorpusFts(database);
            })();
        },

        replaceSource: async (retrievalDir, source, chunks) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(source.sourceType, source.sourceKey);
                insertSource(database, source, chunks);
                rebuildCorpusFts(database);
            })();
        },

        replaceSourcesByType: async (retrievalDir, sourceType, sources) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
                for (const source of sources) {
                    insertSource(database, source.source, source.chunks);
                }
                rebuildCorpusFts(database);
            })();
        },

        removeSource: async (retrievalDir, sourceType, sourceKey) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(sourceType, sourceKey);
                rebuildCorpusFts(database);
            })();
        },

        removeSourcesByType: async (retrievalDir, sourceType) => {
            const database = await corpusDatabase.open(retrievalDir);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
                rebuildCorpusFts(database);
            })();
        },

        countSources: async (retrievalDir) => {
            const database = await corpusDatabase.open(retrievalDir);
            const result = database.prepare('SELECT COUNT(*) AS count FROM sources').get() as { count: number };
            return result.count;
        },

        rebuildSearchIndex: async (retrievalDir) => {
            const database = await corpusDatabase.open(retrievalDir);
            rebuildCorpusFts(database);
        },

        close: corpusDatabase.close,
    };
};

/**
 * Inserts one source row and all of its chunks.
 *
 * This helper assumes the caller has already deleted any previous version of
 * the source and is running inside the appropriate transaction.
 */
const insertSource = (database: BetterSqliteDatabase, source: CorpusSource, chunks: CorpusChunk[]): void => {
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            source.sourceId,
            source.sourceType,
            source.sourceKey,
            source.title,
            JSON.stringify(source.metadata),
            source.status,
            now,
            now,
        );

    const insertChunk = database.prepare(
        `INSERT INTO chunks (
          chunk_id,
          source_id,
          chunk_index,
          text,
          citation_json,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const chunk of chunks) {
        insertChunk.run(
            chunk.chunkId,
            chunk.sourceId,
            chunk.chunkIndex,
            chunk.text,
            JSON.stringify(chunk.citation),
            JSON.stringify(chunk.metadata),
        );
    }
};
