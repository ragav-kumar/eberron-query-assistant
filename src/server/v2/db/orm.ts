import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase } from './database.js';
import type { V2Orm } from './contract.js';
import { createLoaders } from './loaders.js';
import { createSchema } from './schemaDefinition.js';
import { createNpcRepository } from './repositories/npcsRepository.js';
import { createRunAuditLogsRepository } from './repositories/runAuditLogsRepository.js';
import { createRunsRepository } from './repositories/runsRepository.js';
import { createSessionEntriesRepository } from './repositories/sessionEntriesRepository.js';
import { createSessionsRepository } from './repositories/sessionsRepository.js';
import { createSettingsRepository } from './repositories/settingsRepository.js';

const createV2Orm = (): V2Orm => {
    const appDatabase = createAppDatabase();

    const getDatabase = async (config: RuntimeConfig): Promise<Database.Database> => {
        const database = await appDatabase.open(config);
        createSchema(database);
        return database;
    };

    const loaders = createLoaders();
    const repositoryDependencies = { getDatabase };

    return {
        bootstrap: async config => {
            await getDatabase(config);
        },
        close: () => {
            appDatabase.close();
        },
        npcs: createNpcRepository(repositoryDependencies, loaders),
        runAuditLogs: createRunAuditLogsRepository(repositoryDependencies, loaders),
        runs: createRunsRepository(repositoryDependencies, loaders),
        sessionEntries: createSessionEntriesRepository(repositoryDependencies, loaders),
        sessions: createSessionsRepository(repositoryDependencies, loaders),
        settings: createSettingsRepository(repositoryDependencies),
    };
};

export type { V2Orm } from './contract.js';
export { createV2Orm };
