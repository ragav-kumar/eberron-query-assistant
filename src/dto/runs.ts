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
    mode: SessionMode;
    includePartyContext?: boolean;
    includeAdditionalContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
}
