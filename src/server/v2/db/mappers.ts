import type {
    Npc as ObjectModelNpc,
    Run as ObjectModelRun,
    RunAuditLog as ObjectModelRunAuditLog,
    Session as ObjectModelSession,
    SessionEntry as ObjectModelSessionEntry,
    Setting as ObjectModelSetting,
} from './objectModel.js';
import type {
    StoredNpcRow,
    StoredRunAuditLogRow,
    StoredRunRow,
    StoredSessionEntryRow,
    StoredSessionRow,
    StoredSettingRow,
} from './storedRows.js';

export const toTimestamp = (value: Date | null | undefined): string | null => {
    return value ? value.toISOString() : null;
};

const toDate = (value: string | null): Date | null => {
    return value ? new Date(value) : null;
};

export const mapSettingRow = (row: StoredSettingRow): ObjectModelSetting => {
    return {
        key: row.key,
        modifiedAt: new Date(row.modified_at),
        value: row.value,
    };
};

export const mapRunAuditLogRow = (row: StoredRunAuditLogRow): ObjectModelRunAuditLog => {
    return {
        createdAt: new Date(row.created_at),
        details: row.details,
        id: row.id,
        kind: row.kind,
        runId: row.run_id,
    };
};

export const mapNpcRow = (row: StoredNpcRow): ObjectModelNpc => {
    const npc: ObjectModelNpc = {
        bio: row.bio,
        description: row.description,
        id: row.id,
        name: row.name,
        runId: row.run_id,
        sessionId: row.session_id,
    };

    if (row.age !== null) {
        npc.age = row.age;
    }
    if (row.created_at !== null) {
        npc.createdAt = new Date(row.created_at);
    }
    if (row.ethnicity !== null) {
        npc.ethnicity = row.ethnicity;
    }
    if (row.gender !== null) {
        npc.gender = row.gender;
    }
    if (row.modified_at !== null) {
        npc.modifiedAt = new Date(row.modified_at);
    }
    if (row.role !== null) {
        npc.role = row.role;
    }
    if (row.species !== null) {
        npc.species = row.species;
    }

    return npc;
};

export const mapRunRow = (row: StoredRunRow, auditLogs?: ObjectModelRunAuditLog[]): ObjectModelRun => {
    const run: ObjectModelRun = {
        completedAt: toDate(row.completed_at),
        createdAt: new Date(row.created_at),
        failedAt: toDate(row.failed_at),
        id: row.id,
        includePartyContext: row.include_party_context === 1,
        kind: row.kind,
        prompt: row.prompt,
        retrievalTurnLimit: row.retrieval_turn_limit,
        sessionId: row.session_id,
        startedAt: toDate(row.started_at),
        status: row.status,
        updatedAt: new Date(row.updated_at),
    };

    if (auditLogs) {
        run.auditLogs = auditLogs;
    }

    return run;
};

export const mapSessionEntryRow = (row: StoredSessionEntryRow, npcs: ObjectModelNpc[]): ObjectModelSessionEntry => {
    const base = {
        createdAt: new Date(row.created_at),
        entryIndex: row.entry_index,
        runId: row.run_id,
        sessionId: row.session_id,
    };

    if (row.title !== null) {
        Object.assign(base, { title: row.title });
    }

    switch (row.kind) {
        case 'user':
            return {
                ...base,
                content: row.content ?? '',
                kind: 'user',
            };
        case 'assistant-response':
            return {
                ...base,
                content: row.content ?? '',
                kind: 'assistant-response',
            };
        case 'assistant-tool':
            return {
                ...base,
                content: row.content ?? '',
                kind: 'assistant-tool',
            };
        case 'system':
            return {
                ...base,
                content: row.content ?? '',
                kind: 'system',
            };
        case 'assistant-npc':
            return {
                ...base,
                kind: 'assistant-npc',
                npcs,
            };
    }
};

export const mapSessionRow = (
    row: StoredSessionRow,
    entries: ObjectModelSessionEntry[],
    activeRun: ObjectModelRun | null,
): ObjectModelSession => {
    const session: ObjectModelSession = {
        activeRun,
        activeRunId: row.active_run_id,
        archivedAt: toDate(row.archived_at),
        createdAt: new Date(row.created_at),
        entries,
        id: row.id,
        kind: row.kind,
        lastEntryAt: toDate(row.last_entry_at),
        updatedAt: new Date(row.updated_at),
    };

    if (row.title !== null) {
        session.title = row.title;
    }

    return session;
};
