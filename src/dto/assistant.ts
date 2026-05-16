import type { RunStatus } from './runs.js';

export type AssistantEntryKind = 'user' | 'reasoning' | 'response';

interface AssistantEntryBase {
    id: string;
    kind: AssistantEntryKind;
    sessionId: string;
    runId: string;
    exchangeId: string;
    createdAt: string;
    content: string;
}

export interface AssistantUserEntry extends AssistantEntryBase {
    kind: 'user';
}

export interface AssistantReasoningEntry extends AssistantEntryBase {
    kind: 'reasoning';
    toolCallId: string | null;
}

export interface AssistantResponseEntry extends AssistantEntryBase {
    kind: 'response';
    title?: string;
}

export type AssistantEntry =
    | AssistantUserEntry
    | AssistantReasoningEntry
    | AssistantResponseEntry

export interface AssistantExchange {
    id: string;
    sessionId: string;

    createdAt: string;
    updatedAt: string;

    runId: string;
    status: RunStatus;
    entries: AssistantEntry[];
}

export interface AssistantEntries {
    sessionId: string;
    exchanges: AssistantExchange[];
}