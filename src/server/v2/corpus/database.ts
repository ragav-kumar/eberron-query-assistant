import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

const CORPUS_DATABASE_FILENAME = 'corpus.sqlite';

export interface CorpusDatabase {
    close: () => void;
    open: (config: RuntimeConfig, options?: { readonly?: boolean }) => Promise<Database.Database>;
}

export const getCorpusDatabasePath = (config: RuntimeConfig): string => path.join(config.retrievalDir, CORPUS_DATABASE_FILENAME);

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

    const open = async (config: RuntimeConfig, options: { readonly?: boolean } = {}): Promise<Database.Database> => {
        const nextDatabasePath = getCorpusDatabasePath(config);
        const nextReadonly = options.readonly === true;
        if (database && databasePath === nextDatabasePath && readonly === nextReadonly) {
            return database;
        }

        close();
        await mkdir(config.retrievalDir, { recursive: true });
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
