import type { RunStatus } from './runs.js';

export type SessionMode = 'assistant' | 'npc';
export type SessionState = 'temporary' | 'durable';

export interface SessionSummary {
    id: string;
    mode: SessionMode;
    state: SessionState;
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
    state: SessionState;
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
    state?: SessionState;
}

export interface UpdateSession {
    title?: string;
    includePartyContext?: boolean | null;
    state?: SessionState;
    promotedFromSessionId?: string | null;
    promotedToSessionId?: string | null;
}

export interface SessionEntryBase {
    id: string;
    sessionId: string;
    runId: string;
    exchangeId: string;
    createdAt: string;
}

export interface SessionUserEntry extends SessionEntryBase {
    kind: 'user';
    content: string;
}

export interface SessionAssistantReasoningEntry extends SessionEntryBase {
    kind: 'assistant-reasoning';
    content: string;
    toolCallId: string | null;
}

export interface SessionAssistantEntry extends SessionEntryBase {
    kind: 'assistant';
    content: string;
    title?: string;
}

export interface SessionToolStatusEntry extends SessionEntryBase {
    kind: 'tool-status';
    content: string;
    toolCallId: string | null;
    toolName: string | null;
    status: 'requested' | 'running' | 'completed' | 'failed';
}

export interface SessionSystemEntry extends SessionEntryBase {
    kind: 'system';
    content: string;
}

export type SessionEntry =
    | SessionUserEntry
    | SessionAssistantReasoningEntry
    | SessionAssistantEntry
    | SessionToolStatusEntry
    | SessionSystemEntry;

export interface SessionExchange {
    id: string;
    sessionId: string;
    runId: string;
    mode: SessionMode;
    createdAt: string;
    updatedAt: string;
    status: RunStatus;
    entries: SessionEntry[];
}

export interface SessionEntriesResponse {
    sessionId: string;
    exchanges: SessionExchange[];
}
