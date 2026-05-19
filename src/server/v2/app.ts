import { AppDb, createAppDb, resolveAppDatabasePath } from './db/app/index.js';
import {
    createConsoleEventPublisher,
    createRefreshCoordinator,
    createRunCoordinator,
    createStartupOrchestrator,
    createRuntimeEventPublisher,
} from './services/index.js';
import type {
    ConsoleEventPublisher,
    RefreshCoordinator,
    RunCoordinator,
    RuntimeEventPublisher,
} from './services/index.js';

/**
 * This wraps the database lifecycle plus the process-local runtime
 * services that do not belong in SQLite itself.
 */
export interface V2AppContext extends AppDb {
    consoleEvents: ConsoleEventPublisher;
    refreshCoordinator: RefreshCoordinator;
    runCoordinator: RunCoordinator;
    runtimeEvents: RuntimeEventPublisher;
}

// noinspection JSUnusedGlobalSymbols
export const createV2App = async (): Promise<V2AppContext> => {
    const appDb = await createAppDb(resolveAppDatabasePath());
    const startupOrchestrator = createStartupOrchestrator(appDb);
    const consoleEvents = await createConsoleEventPublisher(appDb);
    const runtimeEvents = createRuntimeEventPublisher();

    await startupOrchestrator.initializeRefreshState();

    return {
        db: appDb.db,
        close: appDb.close,
        refreshCoordinator: createRefreshCoordinator(appDb, {
            consoleEvents,
            runtimeEvents,
        }),
        runCoordinator: createRunCoordinator(),
        consoleEvents,
        runtimeEvents,
    };
};
