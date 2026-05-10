import type { ConsoleLevel } from './types.js';

export interface ConsoleEntry {
    id: string;
    level: ConsoleLevel;
    message: string;
    timestamp: string;
}

export interface SessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    lastEntryPreview?: string;
}

export interface Session {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
}

export interface CreateSession {
    title?: string;
}

export interface SessionUserEntry {
    id: string;
    kind: 'user';
    createdAt: string;
    content: string;
}

export interface SessionAssistantEntry {
    id: string;
    kind: 'assistant';
    createdAt: string;
    content: string;
    title?: string;
}

export interface SessionToolStatusEntry {
    id: string;
    kind: 'tool-status';
    createdAt: string;
    content: string;
}

export interface SessionSystemEntry {
    id: string;
    kind: 'system';
    createdAt: string;
    content: string;
}

export type SessionEntry =
    | SessionUserEntry
    | SessionAssistantEntry
    | SessionToolStatusEntry
    | SessionSystemEntry;

export interface Run {
    id: string;
    sessionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
}

export interface CreateRun {
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
}

export interface Npc {
    age?: string;
    bio: string;
    createdAt?: string;
    description: string;
    ethnicity?: string;
    gender?: string;
    id: number;
    name: string;
    role?: string;
    species?: string;
    updatedAt?: string;
}

export interface NpcCollection {
    npcs: Npc[];
}

export interface ProviderDebugEntry {
    assistantContent?: string;
    endpoint: string;
    error?: string;
    ok: boolean;
    operation: string;
    operationId: string;
    purpose: string;
    requestBody: {
        messages: unknown[];
        model: string;
        tools?: unknown[];
    };
    responseBody?: unknown;
    status?: number;
    timestamp: string;
}

export interface CreateRefresh {
    forceReingest: boolean;
}

export interface Refresh {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    forceReingest: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ApiError {
    console?: ConsoleEntry[];
    error?: string;
    operation?: string;
    providerDebug?: ProviderDebugEntry[];
}

export interface ConsoleSnapshot {
    entries: ConsoleEntry[];
}

export interface OperationEvent {
    resource: 'run' | 'refresh' | 'session-entry';
    action: 'created' | 'updated' | 'completed' | 'failed' | 'appended';
    resourceId: string;
    sessionId?: string;
    timestamp: string;
}
