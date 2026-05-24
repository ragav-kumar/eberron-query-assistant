import { SessionMode } from '@/types.js';
import { RunDto } from './runs.js';

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
