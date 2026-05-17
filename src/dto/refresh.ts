import type { RefreshOperationKind, RefreshStatus } from '@/types.js';

export interface CreateRefresh {
    kind: RefreshOperationKind;
}

export interface Refresh {
    activeOperation: RefreshOperationKind | null;
    lastRefreshAt: string | null;
    lastReingestAt: string | null;
    refreshStatus: RefreshStatus;
    reingestStatus: RefreshStatus;
    createdAt: string;
    updatedAt: string;
}
