import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

export interface RepositoryDependencies {
    getDatabase: (config: RuntimeConfig) => Promise<Database.Database>;
}
