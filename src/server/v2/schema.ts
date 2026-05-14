/**
 * Storage-oriented schema reference for the v2 app state database.
 *
 * This file is intentionally a conceptual description of the normalized
 * persistence model. It is not a REST DTO definition and it is not intended to
 * describe projected read models.
 */

/**
 * Singleton-style application settings persisted as plain string values.
 *
 * Notes:
 * - `value` should remain plain text unless a concrete requirement forces a
 *   more structured storage format.
 * - Additional context and environment-backed overrides can be represented
 *   here as individual settings rows.
 */
export interface Setting {
    // Primary key
    key: string;
    value: string;
    modifiedAt: Date;
}

/**
 * Durable orchestrator resource for a resumable conversation.
 *
 * Notes:
 * - `activeRunId` references the currently active run when one exists.
 * - `kind` distinguishes assistant-oriented sessions from NPC-generation
 *   sessions while keeping both inside one shared session model.
 */
export interface Session {
    // Primary key, GUID
    id: string;
    kind: 'assistant' | 'npc';
    title?: string;
    activeRunId?: string | null;
    archivedAt?: Date | null;
    lastEntryAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Ordered, session-scoped timeline entry.
 *
 * Composite primary key:
 * - `sessionId`
 * - `entryIndex`
 *
 * Notes:
 * - `runId` is nullable because some entries may be session-owned rather than
 *   emitted by a specific run.
 * - `assistant-npc` is a timeline marker for generated NPC output.
 * - For `assistant-npc`, `content` is ignored and consumers should resolve the
 *   related NPC rows through the session/run relationship instead.
 */
export interface SessionEntry {
    // Composite primary key part 1
    sessionId: string;

    // Composite primary key part 2
    entryIndex: number;

    // Foreign key to the producing run when applicable
    runId?: string | null;

    title?: string;
    kind: 'user' | 'assistant-response' | 'assistant-tool' | 'system' | 'assistant-npc';
    content?: string;
    createdAt: Date;
}

/**
 * Execution record scoped to one owning session.
 *
 * Notes:
 * - Runs hold execution inputs and lifecycle state.
 * - Run audit logs attach to this entity rather than to session entries.
 */
export interface Run {
    // Primary key, GUID
    id: string;

    // Foreign key to Session.id
    sessionId: string;

    // Input options captured at run creation time
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;

    kind: 'assistant' | 'npc';
    status: 'pending' | 'running' | 'completed' | 'failed';
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
}

/**
 * Run-scoped audit log row.
 *
 * Notes:
 * - This table is separate from user-visible session entries.
 * - `details` is intentionally plain text so audit persistence can stay simple.
 */
export interface RunAuditLog {
    // Primary key, GUID
    id: string;

    // Foreign key to Run.id
    runId: string;

    kind: string;
    details: string;
    createdAt: Date;
}

/**
 * Durable generated NPC record.
 *
 * Notes:
 * - NPC generation still appears in the session timeline through
 *   `assistant-npc` entries.
 * - The actual structured NPC payload lives here rather than inline on a
 *   session entry.
 * - Provenance fields connect each NPC back to the producing session/run path.
 */
export interface Npc {
    // Primary key
    id: number;

    // Foreign keys to the producing conversation context
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
