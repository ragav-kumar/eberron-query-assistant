import { createTaggedError } from '@/errors.js';
import type { RefreshOperationKind } from '@/types.js';
import type { RefreshState } from '@server/db/app/index.js';

/**
 * Enforces the top-level refresh/reingest exclusivity rules.
 *
 * The service allows at most one active operation at a time. The only special
 * case is that a reingest request may replace a running refresh.
 */
export const assertCanStartOperation = (
    snapshot: RefreshState,
    requestedKind: RefreshOperationKind,
): void => {
    if (!snapshot.activeOperation) {
        return;
    }

    if (snapshot.activeOperation === 'refresh' && requestedKind === 'reingest') {
        return;
    }

    throw createTaggedError(
        'refresh-operation-conflict',
        `Cannot start ${requestedKind} while ${snapshot.activeOperation} is active.`,
    );
};
