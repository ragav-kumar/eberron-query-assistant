import Database from 'better-sqlite3';
import { createConsoleEntriesRepository } from './consoleEntriesRepository.js';
import { createIngestedArticlesRepository } from './ingestedArticlesRepository.js';
import { createIngestedFilesRepository } from './ingestedFilesRepository.js';
import { createNpcRepository } from './npcsRepository.js';
import { createRefreshStateRepository } from './refreshStateRepository.js';
import { createRunsRepository } from './runsRepository.js';
import { createSessionExchangesRepository } from './sessionExchangesRepository.js';
import { createSessionsRepository } from './sessionsRepository.js';
import { createSettingsRepository } from './settingsRepository.js';

export const createRepositories = (getDatabase: () => Promise<Database.Database>) => ({
    consoleEntries: createConsoleEntriesRepository(getDatabase),
    ingestedArticles: createIngestedArticlesRepository(getDatabase),
    ingestedFiles: createIngestedFilesRepository(getDatabase),
    npcs: createNpcRepository(getDatabase),
    refreshState: createRefreshStateRepository(getDatabase),
    runs: createRunsRepository(getDatabase),
    sessionExchanges: createSessionExchangesRepository(getDatabase),
    sessions: createSessionsRepository(getDatabase),
    settings: createSettingsRepository(getDatabase),
});
