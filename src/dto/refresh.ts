import { RefreshOperationKind, RefreshStatus } from '@/types.js';

export interface CreateRefreshDto {
    kind: RefreshOperationKind;
}

export interface RefreshDto {
    activeOperation: RefreshOperationKind | null;
    lastRefreshAt: string | null;
    lastReingestAt: string | null;
    refreshStatus: RefreshStatus;
    reingestStatus: RefreshStatus;
    createdAt: string;
    updatedAt: string;
}
