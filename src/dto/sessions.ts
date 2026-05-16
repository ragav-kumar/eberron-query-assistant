export type SessionMode = 'assistant' | 'npc';

export interface SessionSummary {
    id: string;
    mode: SessionMode;
    title: string;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
    lastEntryPreview?: string;
}

export interface Session {
    id: string;
    mode: SessionMode;
    title: string;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
    promotedFromSessionId: string | null;
    promotedToSessionId: string | null;
}

export interface CreateSession {
    mode: SessionMode;
    title?: string;
    includePartyContext?: boolean | null;
}

export interface UpdateSession {
    title?: string;
    includePartyContext?: boolean | null;
    promotedFromSessionId?: string | null;
    promotedToSessionId?: string | null;
}

