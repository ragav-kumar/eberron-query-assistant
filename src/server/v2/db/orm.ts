import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase } from './inner/database.js';
import { createSchema } from './inner/schemaDefinition.js';
import type { Orm } from './contract.js';
import {
    mapConsoleEntryRow,
    mapNpcRow,
    mapRefreshStateRow,
    mapRunRow,
    mapSessionExchangeRow,
    mapSessionRow,
    mapSettingRow,
    toStoredConsoleEntryRow,
    toStoredNpcRow,
    toStoredRefreshStateRow,
    toStoredRunRow,
    toStoredSessionExchangeRow,
    toStoredSessionRow,
    toStoredSettingRow,
} from './mappers.js';
import { createRepositories } from './inner/repositories/index.js';

export const createOrm = (config: RuntimeConfig): Orm => {
    const appDatabase = createAppDatabase();

    const getDatabase = async (): Promise<Database.Database> => {
        const database = await appDatabase.open(config);
        createSchema(database);
        return database;
    };

    const repositories = createRepositories(getDatabase);

    const loadRun = async (runId: string) => {
        const row = await repositories.runs.get(runId);
        return row ? mapRunRow(row) : null;
    };

    const loadSessionExchanges = async (sessionId: string) => {
        const rows = await repositories.sessionExchanges.listBySession(sessionId);
        return rows.map(mapSessionExchangeRow);
    };

    const loadSession = async (sessionId: string, options?: Parameters<Orm['sessions']['get']>[1]) => {
        const row = await repositories.sessions.get(sessionId);
        if (!row) {
            return null;
        }

        const exchanges = options?.includeExchanges === false ? [] : await loadSessionExchanges(sessionId);
        const activeRun = options?.includeActiveRun === false || row.active_run_id === null
            ? null
            : await loadRun(row.active_run_id);

        return mapSessionRow(row, exchanges, activeRun);
    };

    return {
        bootstrap: async () => {
            await getDatabase();
        },
        close: () => {
            appDatabase.close();
        },
        consoleEntries: {
            get: async id => {
                const row = await repositories.consoleEntries.get(id);
                return row ? mapConsoleEntryRow(row) : null;
            },
            list: async () => (await repositories.consoleEntries.list()).map(mapConsoleEntryRow),
            save: async entry => {
                await repositories.consoleEntries.save(toStoredConsoleEntryRow(entry));
            },
        },
        npcs: {
            get: async id => {
                const row = await repositories.npcs.get(id);
                return row ? mapNpcRow(row) : null;
            },
            list: async () => (await repositories.npcs.list()).map(mapNpcRow),
            listByRun: async runId => (await repositories.npcs.listByRun(runId)).map(mapNpcRow),
            listBySession: async sessionId => (await repositories.npcs.listBySession(sessionId)).map(mapNpcRow),
            save: async npc => {
                await repositories.npcs.save(toStoredNpcRow(npc));
            },
        },
        refreshState: {
            get: async () => {
                const row = await repositories.refreshState.get();
                return row ? mapRefreshStateRow(row) : null;
            },
            save: async refreshState => {
                await repositories.refreshState.save(toStoredRefreshStateRow(refreshState));
            },
        },
        runs: {
            get: async id => loadRun(id),
            listBySession: async sessionId => (await repositories.runs.listBySession(sessionId)).map(mapRunRow),
            save: async run => {
                await repositories.runs.save(toStoredRunRow(run));
            },
        },
        sessionExchanges: {
            get: async id => {
                const row = await repositories.sessionExchanges.get(id);
                return row ? mapSessionExchangeRow(row) : null;
            },
            listBySession: async sessionId => (await repositories.sessionExchanges.listBySession(sessionId)).map(mapSessionExchangeRow),
            listByRun: async runId => (await repositories.sessionExchanges.listByRun(runId)).map(mapSessionExchangeRow),
            save: async exchange => {
                await repositories.sessionExchanges.save(toStoredSessionExchangeRow(exchange));
            },
        },
        sessions: {
            get: async (id, options) => loadSession(id, options),
            list: async () => {
                const rows = await repositories.sessions.list();
                return Promise.all(rows.map(async row => {
                    const exchanges = await loadSessionExchanges(row.id);
                    const activeRun = row.active_run_id ? await loadRun(row.active_run_id) : null;
                    return mapSessionRow(row, exchanges, activeRun);
                }));
            },
            save: async session => {
                await repositories.sessions.save(toStoredSessionRow(session));
            },
        },
        settings: {
            get: async key => {
                const row = await repositories.settings.get(key);
                return row ? mapSettingRow(row) : null;
            },
            list: async () => (await repositories.settings.list()).map(mapSettingRow),
            save: async setting => {
                await repositories.settings.save(toStoredSettingRow(setting));
            },
        },
    };
};
