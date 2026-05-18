import type { RunStatus, SessionMode } from '@/types.js';

interface SessionEntryBase {
    id: string;
    kind: 'user' | 'reasoning' | 'response';
    sessionId: string;
    runId: string;
    createdAt: string;
    content: string;
}

export interface SessionEntryUser extends SessionEntryBase {
    kind: 'user';
}

export interface SessionEntryReasoning extends SessionEntryBase {
    kind: 'reasoning';
    toolCallId: string | null;
}

export interface SessionEntryResponse extends SessionEntryBase {
    kind: 'response';
    title?: string;
}

export type SessionEntry =
    | SessionEntryUser
    | SessionEntryReasoning
    | SessionEntryResponse;

export interface Run {
    id: string;
    sessionId: string;
    mode: SessionMode;
    status: RunStatus;
    createdAt: string;
    updatedAt: string;
    sessionEntries: SessionEntry[];
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
