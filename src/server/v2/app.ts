import { createAppDb, resolveAppDatabasePath } from './db/app/index.js';
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
import type { AppDb } from './db/app/index.js';

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
export interface CreateV2AppDependencies {
    appDbPath?: string;
    consoleEventsFactory?: (appDb: AppDb) => Promise<ConsoleEventPublisher>;
    refreshCoordinatorFactory?: (
        appDb: AppDb,
        dependencies: { consoleEvents: ConsoleEventPublisher; runtimeEvents: RuntimeEventPublisher },
    ) => RefreshCoordinator;
    repoRoot?: string;
    runtimeEventsFactory?: () => RuntimeEventPublisher;
}

// noinspection JSUnusedGlobalSymbols
export const createV2App = async (dependencies: CreateV2AppDependencies = {}): Promise<V2AppContext> => {
    const appDb = await createAppDb(dependencies.appDbPath ?? resolveAppDatabasePath(dependencies.repoRoot));
    const consoleEvents = await (dependencies.consoleEventsFactory ?? createConsoleEventPublisher)(appDb);
    const runtimeEvents = (dependencies.runtimeEventsFactory ?? createRuntimeEventPublisher)();
    const refreshCoordinator = (dependencies.refreshCoordinatorFactory ?? createRefreshCoordinator)(appDb, {
        consoleEvents,
        runtimeEvents,
    });
    const startupOrchestrator = createStartupOrchestrator(appDb, {
        consoleEvents,
        refreshCoordinator,
        repoRoot: dependencies.repoRoot,
        runtimeEvents,
    });

    await startupOrchestrator.bootstrap();
    startupOrchestrator.startBackgroundRefresh();

    return {
        db: appDb.db,
        close: appDb.close,
        refreshCoordinator,
        runCoordinator: createRunCoordinator(),
        consoleEvents,
        runtimeEvents,
    };
};
