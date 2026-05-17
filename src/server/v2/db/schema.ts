import type {
    ConsoleLevel,
    RefreshOperationKind,
    RefreshStatus,
    RunStatus,
    SessionFeedEntryKind,
    SessionMode,
} from '@/types.js';

type NullableRefreshOperationKind = RefreshOperationKind | null;

export interface Setting {
    key: string;
    value: string;
    modified_at: string;
}

export interface RefreshState {
    singleton_key: number;
    active_operation: NullableRefreshOperationKind;
    refresh_status: RefreshStatus;
    reingest_status: RefreshStatus;
    last_refresh_at: string | null;
    last_reingest_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Session {
    id: string;
    mode: SessionMode;
    title: string | null;
    active_run_id: string | null;
    include_party_context: number;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SessionExchange {
    id: string;
    session_id: string;
    run_id: string;
    exchange_id: string;
    sequence_index: number;
    kind: SessionFeedEntryKind;
    content: string;
    title: string | null;
    tool_call_id: string | null;
    created_at: string;
}

export interface Run {
    id: string;
    session_id: string;
    exchange_id: string;
    mode: SessionMode;
    status: RunStatus;
    prompt: string;
    retrieval_turn_limit: number;
    include_party_context: number;
    error: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
    failed_at: string | null;
}

export interface Npc {
    id: number;
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
    updated_at: string | null;
}

export interface ConsoleEntry {
    id: string;
    level: ConsoleLevel;
    message: string;
    created_at: string;
}
