import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

const CORPUS_DATABASE_FILENAME = 'corpus.sqlite';

/**
 * Small connection manager for the corpus database file.
 *
 * This object exists so higher-level corpus services can share one writable
 * handle when it is safe to do so, while still allowing read-only openings when
 * they specifically need them. It does not own schema setup or domain logic;
 * callers should pair it with the schema/store/retrieval helpers in this folder.
 */
export interface CorpusDatabase {
    /**
     * Closes the currently cached SQLite handle, if one is open.
     *
     * Use this when a caller is shutting down, or before deleting/replacing the
     * database file. This is especially important on Windows where open SQLite
     * handles can prevent file deletion.
     */
    close: () => void;

    /**
     * Opens the corpus database for the given retrieval directory.
     *
     * Reuses the cached handle when the path and readonly mode match the prior
     * call. The method also ensures the configured corpus directory exists and
     * enables SQLite foreign keys on every opened connection.
     */
    open: (retrievalDir: string, options?: { readonly?: boolean }) => Promise<Database.Database>;
}

/**
 * Resolves the filesystem path for the durable corpus database.
 *
 * Most callers should not need this directly and should prefer higher-level
 * services from this folder. It is exported for the narrow set of cases where
 * path-based filesystem checks or external SQLite access are unavoidable.
 *
 * The returned location is intentionally derived through one local helper so
 * the corpus storage root can move later without changing the callers that
 * depend on this path function.
 */
export const getCorpusDatabasePath = (retrievalDir: string): string => path.join(retrievalDir, CORPUS_DATABASE_FILENAME);

/**
 * Creates a reusable connection manager for the corpus database file.
 *
 * Prefer creating this indirectly through `createCorpusStore()` unless you are
 * building another corpus-internal abstraction. External code should
 * generally not coordinate raw corpus database handles on its own.
 */
export const createCorpusDatabase = (): CorpusDatabase => {
    let database: Database.Database | null = null;
    let databasePath: string | null = null;
    let readonly = false;

    const close = (): void => {
        database?.close();
        database = null;
        databasePath = null;
        readonly = false;
    };

    const open = async (retrievalDir: string, options: { readonly?: boolean } = {}): Promise<Database.Database> => {
        const nextDatabasePath = getCorpusDatabasePath(retrievalDir);
        const nextReadonly = options.readonly === true;
        if (database && databasePath === nextDatabasePath && readonly === nextReadonly) {
            return database;
        }

        close();
        await mkdir(retrievalDir, { recursive: true });
        database = new Database(nextDatabasePath, nextReadonly ? { readonly: true } : undefined);
        databasePath = nextDatabasePath;
        readonly = nextReadonly;
        database.pragma('foreign_keys = ON');
        return database;
    };

    return {
        close,
        open,
    };
};
