import { rm } from 'node:fs/promises';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

import { createTaggedError } from '@/errors.js';
import type { CorpusChunk, CorpusSource, RuntimeConfig, SourceType } from '@/types.js';

import { createCorpusDatabase, getCorpusDatabasePath } from './database.js';
import { createCorpusSchema, isCompatibleCorpusSchema, rebuildCorpusFts } from './schema.js';

export interface CorpusStore {
    applySourceChanges(
        config: RuntimeConfig,
        options: {
            changes: Array<
                | { kind: 'delete'; sourceKey: string; sourceType: SourceType }
                | { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource }
            >;
            clearSourceType?: SourceType;
        },
    ): Promise<void>;
    clear(config: RuntimeConfig): Promise<void>;
    close(): void;
    countSources(config: RuntimeConfig): Promise<number>;
    initialize(config: RuntimeConfig, options?: { allowIncompatibleReset?: boolean }): Promise<void>;
    rebuildSearchIndex(config: RuntimeConfig): Promise<void>;
    removeSource(config: RuntimeConfig, sourceType: SourceType, sourceKey: string): Promise<void>;
    removeSourcesByType(config: RuntimeConfig, sourceType: SourceType): Promise<void>;
    replaceSource(config: RuntimeConfig, source: CorpusSource, chunks: CorpusChunk[]): Promise<void>;
    replaceSourcesByType(
        config: RuntimeConfig,
        sourceType: SourceType,
        sources: Array<{ chunks: CorpusChunk[]; source: CorpusSource }>,
    ): Promise<void>;
}

export const createCorpusStore = (): CorpusStore => {
    const corpusDatabase = createCorpusDatabase();

    const open = async (config: RuntimeConfig) => corpusDatabase.open(config);

    return {
        initialize: async (config, options = {}) => {
            let database = await open(config);
            if (!isCompatibleCorpusSchema(database)) {
                if (options.allowIncompatibleReset !== true) {
                    throw createTaggedError(
                        'incompatible-corpus-schema',
                        'Existing corpus.sqlite is not compatible with the current corpus schema. Use the browser force-reingest control to rebuild retrieval artifacts explicitly.',
                    );
                }
                corpusDatabase.close();
                await rm(getCorpusDatabasePath(config), { force: true });
                database = await open(config);
            }

            createCorpusSchema(database);
        },

        applySourceChanges: async (config, options) => {
            const database = await open(config);
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

        clear: async (config) => {
            const database = await open(config);
            database.transaction(() => {
                database.prepare('DELETE FROM chunks').run();
                database.prepare('DELETE FROM sources').run();
                rebuildCorpusFts(database);
            })();
        },

        replaceSource: async (config, source, chunks) => {
            const database = await open(config);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(source.sourceType, source.sourceKey);
                insertSource(database, source, chunks);
                rebuildCorpusFts(database);
            })();
        },

        replaceSourcesByType: async (config, sourceType, sources) => {
            const database = await open(config);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
                for (const source of sources) {
                    insertSource(database, source.source, source.chunks);
                }
                rebuildCorpusFts(database);
            })();
        },

        removeSource: async (config, sourceType, sourceKey) => {
            const database = await open(config);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ? AND source_key = ?').run(sourceType, sourceKey);
                rebuildCorpusFts(database);
            })();
        },

        removeSourcesByType: async (config, sourceType) => {
            const database = await open(config);
            database.transaction(() => {
                database.prepare('DELETE FROM sources WHERE source_type = ?').run(sourceType);
                rebuildCorpusFts(database);
            })();
        },

        countSources: async (config) => {
            const database = await open(config);
            const result = database.prepare('SELECT COUNT(*) AS count FROM sources').get() as { count: number };
            return result.count;
        },

        rebuildSearchIndex: async (config) => {
            const database = await open(config);
            rebuildCorpusFts(database);
        },

        close: corpusDatabase.close,
    };
};

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
