import type { SessionMode } from './sessions.js';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Run {
    id: string;
    sessionId: string;
    mode: SessionMode;
    status: RunStatus;
    createdAt: string;
    updatedAt: string;
    exchangeId: string;
    failedAt?: string;
    error?: string;
}

export interface CreateRun {
    // If not set, create a temporary session in memory
    sessionId?: string | undefined | null;
    mode: SessionMode;
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
}
