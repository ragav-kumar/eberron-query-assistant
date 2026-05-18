import type { Refresh, Run } from '@/dto/index.js';

export const DEFAULT_CREATED_RUN: Run = {
    id: 'run-dal-quor-1',
    sessionId: 'session-dal-quor',
    mode: 'assistant',
    status: 'completed',
    createdAt: '2026-05-07T21:10:42.000Z',
    sessionEntries: [],
    updatedAt: '2026-05-07T21:10:48.000Z',
};

export const REFRESH: Refresh = {
    activeOperation: null,
    lastRefreshAt: '2026-05-08T17:49:08.127Z',
    lastReingestAt: null,
    refreshStatus: 'completed',
    reingestStatus: 'idle',
    createdAt: '2026-05-08T17:49:05.654Z',
    updatedAt: '2026-05-08T17:49:08.127Z',
};
