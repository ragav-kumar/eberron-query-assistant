/**
 * Server-side object model for v2 application state.
 *
 * This file sits above the storage schema and below transport DTOs:
 * - `schema.ts` describes normalized persistence records.
 * - `objectModel.ts` describes the richer shapes server code works with after
 *   loading, assembling, and relating those records.
 * - DTOs remain transport-specific and should stay separate.
 */

/**
 * Application setting as used by server code after loading from persistence.
 */
export interface Setting {
    key: string;
    value: string;
    modifiedAt: Date;
}

export type SessionKind = 'assistant' | 'npc';
export type RunKind = 'assistant' | 'npc';
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type SessionEntryKind =
    | 'user'
    | 'assistant-response'
    | 'assistant-tool'
    | 'system'
    | 'assistant-npc';

/**
 * Durable conversation resource as assembled for server-side use.
 *
 * Notes:
 * - `entries` is the canonical ordered session timeline.
 * - `activeRun` is present only when the session currently has a loaded active
 *   run.
 */
export interface Session {
    id: string;
    kind: SessionKind;
    title?: string;
    activeRunId?: string | null;
    activeRun?: Run | null;
    archivedAt?: Date | null;
    lastEntryAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    entries: SessionEntry[];
}

interface SessionEntryBase {
    sessionId: string;
    entryIndex: number;
    runId?: string | null;
    title?: string;
    createdAt: Date;
}

export interface UserSessionEntry extends SessionEntryBase {
    kind: 'user';
    content: string;
}

export interface AssistantResponseSessionEntry extends SessionEntryBase {
    kind: 'assistant-response';
    content: string;
}

export interface AssistantToolSessionEntry extends SessionEntryBase {
    kind: 'assistant-tool';
    content: string;
}

export interface SystemSessionEntry extends SessionEntryBase {
    kind: 'system';
    content: string;
}

/**
 * Timeline marker for generated NPC output.
 *
 * Notes:
 * - The storage layer links this entry to generated NPC rows indirectly through
 *   session/run provenance.
 * - The assembled object model can attach the resolved NPC list directly so
 *   server logic does not need to re-walk those relations repeatedly.
 */
export interface AssistantNpcSessionEntry extends SessionEntryBase {
    kind: 'assistant-npc';
    npcs: Npc[];
}

export type SessionEntry =
    | UserSessionEntry
    | AssistantResponseSessionEntry
    | AssistantToolSessionEntry
    | SystemSessionEntry
    | AssistantNpcSessionEntry;

/**
 * Execution record as used by server-side orchestration logic.
 *
 * Notes:
 * - Audit logs remain separate from the user-visible session timeline.
 * - `auditLogs` is optional because callers may choose not to materialize them
 *   on every run read.
 */
export interface Run {
    id: string;
    sessionId: string;
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
    kind: RunKind;
    status: RunStatus;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
    auditLogs?: RunAuditLog[];
}

/**
 * Run-scoped audit row used for optional debug and execution tracing.
 */
export interface RunAuditLog {
    id: string;
    runId: string;
    kind: string;
    details: string;
    createdAt: Date;
}

/**
 * Generated NPC as used by server-side application logic.
 */
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
    createdAt?: Date;
    modifiedAt?: Date;
}
