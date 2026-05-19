import { createTaggedError } from '@/errors.js';
import type { RefreshOperationKind, RefreshStatus } from '@/types.js';
import type { SelectRow } from '@/server/v2/db/app/index.js';

export const assertCanStartOperation = (
    snapshot: SelectRow<'refreshState'>,
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

export const assertExpectedStatus = (
    status: RefreshStatus,
    expected: RefreshStatus[],
    kind: RefreshOperationKind,
): void => {
    if (!expected.includes(status)) {
        throw createTaggedError(
            'invalid-refresh-state-transition',
            `Cannot transition ${kind} from ${status}; expected one of ${expected.join(', ')}.`,
        );
    }
};
