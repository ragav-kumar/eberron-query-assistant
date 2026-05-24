import type { Selectable, Updateable } from 'kysely';

import type {
    ConsoleLevel,
    RefreshOperationKind,
    RefreshStatus,
    RunStatus,
    SessionFeedEntryKind,
    SessionMode,
} from '../../../types.js';

type NullableRefreshOperationKind = RefreshOperationKind | null;

/**
 * This is a general-purpose key-value store, not just user settings.
 */
export interface Setting {
    key: string;
    value: string;
    modifiedAt: string;
}

/**
 * Used for both foundry and pdf imports. The primary key is the whole row.
 */
export interface IngestedFile {
    sourceType: 'foundry' | 'pdf';
    filename: string;
}

/**
 * Used for keith baker article imports. Primary key is canonicalUrl.
 */
export interface IngestedArticle {
    canonicalUrl: string;
    title: string | null;
    firstSeenAt: string;
    lastIngestedAt: string | null;
    scrapeStatus: 'pending' | 'succeeded' | 'failed' | 'inaccessible';
}

export interface RefreshState {
    singletonKey: number;
    activeOperation: NullableRefreshOperationKind;
    refreshStatus: RefreshStatus;
    reingestStatus: RefreshStatus;
    lastRefreshAt: string | null;
    lastReingestAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface Session {
    id: string;
    mode: SessionMode;
    title: string;
    activeRunId: string | null;
    includePartyContext: number;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SessionEntry {
    id: string;
    sessionId: string;
    runId: string;
    sequenceIndex: number;
    kind: SessionFeedEntryKind;
    content: string;
    title: string | null;
    toolCallId: string | null;
    createdAt: string;
}

export interface Run {
    id: string;
    sessionId: string;
    mode: SessionMode;
    status: RunStatus;
    prompt: string;
    retrievalTurnLimit: number;
    includePartyContext: number;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    failedAt: string | null;
}

export interface Npc {
    id: number;
    sessionId: string;
    runId: string;
    name: string;
    bio: string;
    description: string;
    age: string | null;
    ethnicity: string | null;
    gender: string | null;
    role: string | null;
    species: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface ConsoleEntry {
    id: string;
    level: ConsoleLevel;
    message: string;
    createdAt: string;
}

export interface AppDatabaseSchema {
    consoleEntries: ConsoleEntry;
    ingestedArticles: IngestedArticle;
    ingestedFiles: IngestedFile;
    npcs: Npc;
    refreshState: RefreshState;
    runs: Run;
    sessionEntries: SessionEntry;
    sessions: Session;
    settings: Setting;
}

export type SelectRow<TableName extends keyof AppDatabaseSchema> = Selectable<AppDatabaseSchema[TableName]>;
export type UpdateRow<TableName extends keyof AppDatabaseSchema> = Updateable<AppDatabaseSchema[TableName]>;
