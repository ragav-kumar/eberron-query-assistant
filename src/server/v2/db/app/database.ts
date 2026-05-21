import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

export interface AppDatabase {
    close: () => void;
    open: (databasePath: string) => Promise<Database.Database>;
}

export const createAppDatabase = (): AppDatabase => {
    let database: Database.Database | null = null;
    let databasePath: string | null = null;

    const close = (): void => {
        database?.close();
        database = null;
        databasePath = null;
    };

    const open = async (nextDatabasePath: string): Promise<Database.Database> => {
        if (database && databasePath === nextDatabasePath) {
            return database;
        }

        close();
        await mkdir(path.dirname(nextDatabasePath), { recursive: true });
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
