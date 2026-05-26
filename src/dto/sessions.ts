import { SessionMode } from '@/types.js';
import { RunDto } from './runs.js';

export const LEGACY_NPC_SESSION_ID = 'legacy-v1-npc-session';

export interface SessionDto {
    id: string;
    mode: SessionMode;
    title: string;
    runCount: number;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
}

export interface SessionFeedDto {
    sessionId: string;
    mode: SessionMode;
    items: RunDto[];
}
