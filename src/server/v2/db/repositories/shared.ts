import type Database from 'better-sqlite3';

export interface RepositoryDependencies {
    getDatabase: () => Promise<Database.Database>;
}
