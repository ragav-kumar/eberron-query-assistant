import { RefreshOperationKind, RefreshStatus, RunStatus, SessionMode } from '@/types.js';
import { SessionEntryDto } from './runs.js';
import { SessionDto } from './sessions.js';

interface EventBase {
    resource: string;
    action: string;
    resourceId: string;
    timestamp: string;
}

export interface RunOperationEventDto extends EventBase {
    resource: 'run';
    action: 'created' | 'updated' | 'completed' | 'failed';
    sessionId: string;
    status: RunStatus;
}

export interface RefreshOperationEventDto extends EventBase {
    resource: 'refresh';
    action: 'created' | 'updated' | 'completed' | 'failed';
    kind: RefreshOperationKind;
    status: RefreshStatus;
}

export interface SessionEntryOperationEventDto extends EventBase {
    resource: 'session-entry';
    action: 'appended';
    sessionId: string;
    runId: string;
    entry: SessionEntryDto;
}

export interface SessionOperationEventDto extends EventBase {
    resource: 'session';
    action: 'promoted' | 'updated';
    sessionId: string;
    replacedSessionId?: string;
    mode: SessionMode;
    state: SessionDto;
}

export type OperationEventDto =
    | RunOperationEventDto
    | RefreshOperationEventDto
    | SessionEntryOperationEventDto
    | SessionOperationEventDto;
