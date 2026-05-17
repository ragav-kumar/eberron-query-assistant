import type {
    ConsoleLevel,
    RefreshOperationKind,
    RefreshStatus,
    RunStatus,
    SessionMode,
} from '@/types.js';

export interface AdditionalContextDocument {
    markdown: string;
    updatedAt: Date;
}

export interface RefreshState {
    activeOperation: RefreshOperationKind | null;
    refreshStatus: RefreshStatus;
    reingestStatus: RefreshStatus;
    lastRefreshAt: Date | null;
    lastReingestAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface Session {
    id: string;
    mode: SessionMode;
    title?: string;
    activeRunId: string | null;
    activeRun?: Run | null;
    includePartyContext: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    exchanges: SessionExchange[];
}

interface SessionExchangeBase {
    id: string;
    sessionId: string;
    runId: string;
    exchangeId: string;
    sequenceIndex: number;
    createdAt: Date;
}

export interface UserSessionExchange extends SessionExchangeBase {
    kind: 'user';
    content: string;
}

export interface ReasoningSessionExchange extends SessionExchangeBase {
    kind: 'reasoning';
    content: string;
    toolCallId: string | null;
}

export interface ResponseSessionExchange extends SessionExchangeBase {
    kind: 'response';
    content: string;
    title?: string;
}

export type SessionExchange =
    | UserSessionExchange
    | ReasoningSessionExchange
    | ResponseSessionExchange;

export interface Run {
    id: string;
    sessionId: string;
    exchangeId: string;
    mode: SessionMode;
    status: RunStatus;
    prompt: string;
    retrievalTurnLimit: number;
    includePartyContext: boolean;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
}

export interface Npc {
    id: number;
    sessionId: string;
    runId: string;
    name: string;
    bio: string;
    description: string;
    age?: string;
    ethnicity?: string;
    gender?: string;
    role?: string;
    species?: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface ConsoleEntry {
    id: string;
    level: ConsoleLevel;
    message: string;
    createdAt: Date;
}
