import type { RefreshOperationKind } from '@/types.js';

import type { RefreshStateStore } from './refresh-state.js';
import type { RefreshVisibility } from './visibility.js';

/**
 * Startup-specific recovery policy for persisted refresh state.
 *
 * Routine launch always prefers `refresh`, except when a prior force reingest
 * was interrupted by shutdown. That destructive rebuild must be resumed as
 * `reingest` so startup does not fall back to incremental refresh semantics.
 */
export const recoverStartupRefreshOperation = async (options: {
    now?: () => Date;
    refreshStateStore: RefreshStateStore;
    visibility: RefreshVisibility;
}): Promise<RefreshOperationKind> => {
    const now = options.now ?? (() => new Date());
    const snapshot = await options.refreshStateStore.read();
    if (!snapshot.activeOperation) {
        return 'refresh';
    }

    const interruptedKind = snapshot.activeOperation;
    const restartingKind = interruptedKind === 'reingest' ? 'reingest' : 'refresh';
    const timestamp = now().toISOString();

    await options.refreshStateStore.fail(interruptedKind, timestamp);
    await options.visibility.publishRecoveredAfterShutdown(interruptedKind, restartingKind, timestamp);

    return restartingKind;
};
