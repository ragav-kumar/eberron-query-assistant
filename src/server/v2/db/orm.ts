import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase } from './database.js';
import type { V2Orm } from './contract.js';
import { createLoaders } from './loaders.js';
import { createSchema } from './schemaDefinition.js';
import { createConsoleEntriesRepository } from './repositories/consoleEntriesRepository.js';
import { createNpcRepository } from './repositories/npcsRepository.js';
import { createRefreshStateRepository } from './repositories/refreshStateRepository.js';
import { createRunsRepository } from './repositories/runsRepository.js';
import { createSessionExchangesRepository } from './repositories/sessionExchangesRepository.js';
import { createSessionsRepository } from './repositories/sessionsRepository.js';
import { createSettingsRepository } from './repositories/settingsRepository.js';

const createV2Orm = (config: RuntimeConfig): V2Orm => {
    const appDatabase = createAppDatabase();

    const getDatabase = async (): Promise<Database.Database> => {
        const database = await appDatabase.open(config);
        createSchema(database);
        return database;
    };

    const loaders = createLoaders();
    const repositoryDependencies = { getDatabase };

    return {
        bootstrap: async () => {
            await getDatabase();
        },
        close: () => {
            appDatabase.close();
        },
        consoleEntries: createConsoleEntriesRepository(repositoryDependencies),
        npcs: createNpcRepository(repositoryDependencies),
        refreshState: createRefreshStateRepository(repositoryDependencies),
        runs: createRunsRepository(repositoryDependencies, loaders),
        sessionExchanges: createSessionExchangesRepository(repositoryDependencies),
        sessions: createSessionsRepository(repositoryDependencies, loaders),
        settings: createSettingsRepository(repositoryDependencies),
    };
};

export type { V2Orm } from './contract.js';
export { createV2Orm };
