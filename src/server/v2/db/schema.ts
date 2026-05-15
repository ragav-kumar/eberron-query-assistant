/**
 * Storage-oriented schema reference for the v2 app state database.
 *
 * This file describes the raw row shapes persisted in SQLite.
 * It is not a REST DTO definition and it is not intended to describe
 * projected read models.
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
    modified_at: string;
}

/**
 * Durable orchestrator resource for a resumable conversation.
 *
 * Notes:
 * - `active_run_id` references the currently active run when one exists.
 * - `kind` distinguishes assistant-oriented sessions from NPC-generation
 *   sessions while keeping both inside one shared session model.
 */
export interface Session {
    // Primary key, GUID
    id: string;
    kind: 'assistant' | 'npc';
    title: string | null;
    active_run_id: string | null;
    archived_at: string | null;
    last_entry_at: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * Ordered, session-scoped timeline entry.
 *
 * Composite primary key:
 * - `session_id`
 * - `entry_index`
 *
 * Notes:
 * - `run_id` is nullable because some entries may be session-owned rather than
 *   emitted by a specific run.
 * - `assistant-npc` is a timeline marker for generated NPC output.
 * - For `assistant-npc`, `content` is ignored and consumers should resolve the
 *   related NPC rows through the session/run relationship instead.
 */
export interface SessionEntry {
    // Composite primary key part 1
    session_id: string;

    // Composite primary key part 2
    entry_index: number;

    // Foreign key to the producing run when applicable
    run_id: string | null;

    title: string | null;
    kind: 'user' | 'assistant-response' | 'assistant-tool' | 'system' | 'assistant-npc';
    content: string | null;
    created_at: string;
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
    session_id: string;

    // Input options captured at run creation time
    include_party_context: number;
    prompt: string;
    retrieval_turn_limit: number;

    kind: 'assistant' | 'npc';
    status: 'pending' | 'running' | 'completed' | 'failed';
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
    failed_at: string | null;
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
    run_id: string;

    kind: string;
    details: string;
    created_at: string;
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
    session_id: string;
    run_id: string;

    name: string;
    bio: string;
    description: string;
    age: string | null;
    ethnicity: string | null;
    gender: string | null;
    role: string | null;
    species: string | null;
    created_at: string | null;
    modified_at: string | null;
}
