import type { CreateRefreshDto, RefreshDto } from '@/dto/index.js';

import type { AppDb } from '../db/app/index.js';

export interface RefreshCoordinator {
    /**
     * TODO: Replace this stub with a real coordinator that:
     * - initializes and validates the singleton refresh row
     * - owns refresh/reingest exclusivity and cancellation rules
     * - invokes the refresh pipeline and updates persistent state
     * - emits runtime and console events for lifecycle transitions
     */
    startRefresh(request: CreateRefreshDto): Promise<RefreshDto>;
}

const readRefreshState = async (appDb: AppDb): Promise<RefreshDto> => {
    const refresh = await appDb.db
        .selectFrom('refreshState')
        .selectAll()
        .executeTakeFirstOrThrow();

    return {
        activeOperation: refresh.activeOperation,
        createdAt: refresh.createdAt,
        lastRefreshAt: refresh.lastRefreshAt,
        lastReingestAt: refresh.lastReingestAt,
        refreshStatus: refresh.refreshStatus,
        reingestStatus: refresh.reingestStatus,
        updatedAt: refresh.updatedAt,
    };
};

export const createRefreshCoordinator = (appDb: AppDb): RefreshCoordinator => ({
    startRefresh: async _request => {
        // TODO: Replace this placeholder read with real refresh/reingest orchestration.
        console.warn('POST /api/v2/refresh is not implemented');
        return readRefreshState(appDb);
    },
});
