import type { AppDb } from '../db/app/index.js';
import { createRefreshStateStore } from './refresh/index.js';
import { initializeRefreshSettings } from './refresh/runtime.js';

/**
 * Startup orchestration is the server-side entry point for app-launch work.
 *
 * This factory will likely need access to any long-lived dependencies that can
 * initiate business actions without an incoming request, for example:
 * - refresh coordination
 * - runtime and console event publishers
 * - startup-time configuration validation
 * - singleton state initialization/repair
 *
 * It should stay focused on startup-origin work only. Request-driven work
 * should continue to enter through routes and the coordinators they call.
 */
export const createStartupOrchestrator = (appDb: AppDb) => {
    // TODO: Replace this startup placeholder with real app-launch orchestration.
    console.warn('V2 startup orchestration is not fully implemented');
    const refreshStateStore = createRefreshStateStore(appDb);
    const repoRoot = process.cwd();

    return {
        initializeRefreshState: async () => {
            await refreshStateStore.ensure();
            await initializeRefreshSettings(appDb, repoRoot);
        },
    };
};
