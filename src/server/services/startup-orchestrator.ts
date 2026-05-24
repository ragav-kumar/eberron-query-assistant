import { ConsoleEventPublisher } from './console-event-publisher.js';
import { createRefreshStateStore, RefreshCoordinator } from './refresh/index.js';
import { recoverStartupRefreshOperation } from './refresh/startup-recovery.js';
import { createRefreshVisibility } from './refresh/visibility.js';
import { RuntimeEventPublisher } from './runtime-event-publisher.js';
import { AppDb, initializeSettingsStore } from '@server/db/app/index.js';

/**
 * Startup orchestration stays focused on app-launch-origin work only:
 * singleton bootstrap plus the background startup refresh kickoff.
 */
export interface StartupOrchestrator {
    bootstrap(): Promise<void>;
    startBackgroundRefresh(): void;
}

export interface StartupOrchestratorDependencies {
    consoleEvents: ConsoleEventPublisher;
    now?: () => Date;
    refreshCoordinator: RefreshCoordinator;
    runtimeEvents: RuntimeEventPublisher;
}

export const createStartupOrchestrator = (
    appDb: AppDb,
    dependencies: StartupOrchestratorDependencies,
): StartupOrchestrator => {
    const refreshStateStore = createRefreshStateStore(appDb);
    const visibility = createRefreshVisibility(dependencies.consoleEvents, dependencies.runtimeEvents);

    const runStartupRefresh = async (): Promise<void> => {
        const nextOperation = await recoverStartupRefreshOperation({
            now: dependencies.now,
            refreshStateStore,
            visibility,
        });
        await dependencies.refreshCoordinator.startRefresh({ kind: nextOperation });
    };

    return {
        bootstrap: async () => {
            await refreshStateStore.ensure();
            await initializeSettingsStore(appDb);
        },
        startBackgroundRefresh: () => {
            void runStartupRefresh().catch(error => {
                console.error('Failed to start V2 startup refresh.', error);
            });
        },
    };
};
