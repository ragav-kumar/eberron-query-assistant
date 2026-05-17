import type { SessionFeedEntryKind, RunStatus } from '@/types.js';

interface SessionFeedEntryBase {
    id: string;
    kind: SessionFeedEntryKind;
    sessionId: string;
    runId: string;
    exchangeId: string;
    createdAt: string;
    content: string;
}

export interface SessionFeedUserEntry extends SessionFeedEntryBase {
    kind: 'user';
}

export interface SessionFeedReasoningEntry extends SessionFeedEntryBase {
    kind: 'reasoning';
    toolCallId: string | null;
}

export interface SessionFeedResponseEntry extends SessionFeedEntryBase {
    kind: 'response';
    title?: string;
}

export type SessionFeedEntry =
    | SessionFeedUserEntry
    | SessionFeedReasoningEntry
    | SessionFeedResponseEntry;

export interface SessionFeedExchange {
    id: string;
    sessionId: string;

    createdAt: string;
    updatedAt: string;

    runId: string;
    status: RunStatus;
    entries: SessionFeedEntry[];
}
