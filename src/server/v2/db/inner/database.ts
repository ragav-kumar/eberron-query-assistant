import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { RuntimeConfig } from '@/types.js';

const APP_DATABASE_FILENAME = 'app.sqlite';

export interface AppDatabase {
    close: () => void;
    open: (config: RuntimeConfig) => Promise<Database.Database>;
}

export const getAppDatabasePath = (config: RuntimeConfig): string => path.join(config.runtimeDir, APP_DATABASE_FILENAME);

export const createAppDatabase = (): AppDatabase => {
    let database: Database.Database | null = null;
    let databasePath: string | null = null;

    const close = (): void => {
        database?.close();
        database = null;
        databasePath = null;
    };

    const open = async (config: RuntimeConfig): Promise<Database.Database> => {
        const nextDatabasePath = getAppDatabasePath(config);
        if (database && databasePath === nextDatabasePath) {
            return database;
        }

        close();
        await mkdir(config.runtimeDir, { recursive: true });
        database = new Database(nextDatabasePath);
        databasePath = nextDatabasePath;
        database.pragma('foreign_keys = ON');
        return database;
    };

    return {
        close,
        open,
    };
};
