export type StoredSessionRow = {
    active_run_id: string | null;
    archived_at: string | null;
    created_at: string;
    id: string;
    kind: 'assistant' | 'npc';
    last_entry_at: string | null;
    title: string | null;
    updated_at: string;
};

export type StoredSessionEntryRow = {
    content: string | null;
    created_at: string;
    entry_index: number;
    kind: 'user' | 'assistant-response' | 'assistant-tool' | 'system' | 'assistant-npc';
    run_id: string | null;
    session_id: string;
    title: string | null;
};

export type StoredRunRow = {
    completed_at: string | null;
    created_at: string;
    failed_at: string | null;
    id: string;
    include_party_context: number;
    kind: 'assistant' | 'npc';
    prompt: string;
    retrieval_turn_limit: number;
    session_id: string;
    started_at: string | null;
    status: 'pending' | 'running' | 'completed' | 'failed';
    updated_at: string;
};

export type StoredRunAuditLogRow = {
    created_at: string;
    details: string;
    id: string;
    kind: string;
    run_id: string;
};

export type StoredNpcRow = {
    age: string | null;
    bio: string;
    created_at: string | null;
    description: string;
    ethnicity: string | null;
    gender: string | null;
    id: number;
    modified_at: string | null;
    name: string;
    role: string | null;
    run_id: string;
    session_id: string;
    species: string | null;
};

export type StoredSettingRow = {
    key: string;
    modified_at: string;
    value: string;
};
