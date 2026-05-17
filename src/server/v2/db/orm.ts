import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase } from './inner/database.js';
import { createConsoleEntriesRepository } from './inner/repositories/consoleEntriesRepository.js';
import { createNpcRepository } from './inner/repositories/npcsRepository.js';
import { createRefreshStateRepository } from './inner/repositories/refreshStateRepository.js';
import { createRunsRepository } from './inner/repositories/runsRepository.js';
import { createSessionExchangesRepository } from './inner/repositories/sessionExchangesRepository.js';
import { createSessionsRepository } from './inner/repositories/sessionsRepository.js';
import { createSettingsRepository } from './inner/repositories/settingsRepository.js';
import { createSchema } from './inner/schemaDefinition.js';
import type { Orm } from './contract.js';
import { createLoaders } from './loaders.js';

export const createOrm = (config: RuntimeConfig): Orm => {
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
