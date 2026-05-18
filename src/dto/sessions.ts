import type { SessionMode } from '@/types.js';
import type { Run } from './runs.js';

export interface Session {
    id: string;
    mode: SessionMode;
    title: string;
    sessionEntryCount: number;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
}

export interface SessionFeed {
    sessionId: string;
    mode: SessionMode;
    items: Run[];
}
