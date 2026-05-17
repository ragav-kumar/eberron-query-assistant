import type { RefreshOperationKind, RefreshStatus } from './refresh.js';
import type { RunStatus } from './runs.js';
import type { SessionFeedEntry } from './sessionFeed.js';
import type { Session, SessionMode } from './sessions.js';

interface EventBase {
    resource: string;
    action: string;
    resourceId: string;
    timestamp: string;
}

export interface RunOperationEvent extends EventBase {
    resource: 'run';
    action: 'created' | 'updated' | 'completed' | 'failed';
    sessionId: string;
    exchangeId: string;
    status: RunStatus;
}

export interface RefreshOperationEvent extends EventBase {
    resource: 'refresh';
    action: 'created' | 'updated' | 'completed' | 'failed';
    kind: RefreshOperationKind;
    status: RefreshStatus;
}

export interface SessionEntryOperationEvent extends EventBase {
    resource: 'session-entry';
    action: 'appended';
    sessionId: string;
    runId: string;
    exchangeId: string;
    entry: SessionFeedEntry;
}

export interface SessionOperationEvent extends EventBase {
    resource: 'session';
    action: 'promoted' | 'updated';
    sessionId: string;
    replacedSessionId?: string;
    mode: SessionMode;
    state: Session;
}

export type OperationEvent =
    | RunOperationEvent
    | RefreshOperationEvent
    | SessionEntryOperationEvent
    | SessionOperationEvent;
