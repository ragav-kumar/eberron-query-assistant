import type Database from 'better-sqlite3';

import type { RunLoadOptions, SessionLoadOptions } from './contract.js';
import {
    mapNpcRow,
    mapRunAuditLogRow,
    mapRunRow,
    mapSessionEntryRow,
    mapSessionRow,
} from './mappers.js';
import type {
    Npc as ObjectModelNpc,
    Run as ObjectModelRun,
    RunAuditLog as ObjectModelRunAuditLog,
    Session as ObjectModelSession,
    SessionEntry as ObjectModelSessionEntry,
} from './objectModel.js';
import type {
    StoredNpcRow,
    StoredRunAuditLogRow,
    StoredRunRow,
    StoredSessionEntryRow,
    StoredSessionRow,
} from './storedRows.js';

export interface V2Loaders {
    loadNpcsByRun: (database: Database.Database, runId: string) => ObjectModelNpc[];
    loadRun: (database: Database.Database, runId: string, options?: RunLoadOptions) => ObjectModelRun | null;
    loadRunAuditLogs: (database: Database.Database, runId: string) => ObjectModelRunAuditLog[];
    loadSession: (database: Database.Database, sessionId: string, options?: SessionLoadOptions) => ObjectModelSession | null;
    loadSessionEntries: (database: Database.Database, sessionId: string) => ObjectModelSessionEntry[];
}

export const createLoaders = (): V2Loaders => {
    const loadRunAuditLogs = (database: Database.Database, runId: string): ObjectModelRunAuditLog[] => {
        const rows = database
            .prepare(`
                SELECT id, run_id, kind, details, created_at
                FROM run_audit_logs
                WHERE run_id = ?
                ORDER BY created_at ASC, id ASC
            `)
            .all(runId) as StoredRunAuditLogRow[];
        return rows.map(mapRunAuditLogRow);
    };

    const loadNpcsBySession = (database: Database.Database, sessionId: string): Map<string, ObjectModelNpc[]> => {
        const rows = database
            .prepare(`
                SELECT
                    id,
                    session_id,
                    run_id,
                    name,
                    bio,
                    description,
                    age,
                    ethnicity,
                    gender,
                    role,
                    species,
                    created_at,
                    modified_at
                FROM npcs
                WHERE session_id = ?
                ORDER BY id ASC
            `)
            .all(sessionId) as StoredNpcRow[];
        const grouped = new Map<string, ObjectModelNpc[]>();

        for (const row of rows) {
            const entry = mapNpcRow(row);
            const existing = grouped.get(entry.runId) ?? [];
            existing.push(entry);
            grouped.set(entry.runId, existing);
        }

        return grouped;
    };

    const loadSessionEntries = (database: Database.Database, sessionId: string): ObjectModelSessionEntry[] => {
        const rows = database
            .prepare(`
                SELECT
                    session_id,
                    entry_index,
                    run_id,
                    title,
                    kind,
                    content,
                    created_at
                FROM session_entries
                WHERE session_id = ?
                ORDER BY entry_index ASC
            `)
            .all(sessionId) as StoredSessionEntryRow[];
        const npcsByRunId = loadNpcsBySession(database, sessionId);

        return rows.map((row) => {
            const npcs = row.run_id ? (npcsByRunId.get(row.run_id) ?? []) : [];
            return mapSessionEntryRow(row, npcs);
        });
    };

    const loadNpcsByRun = (database: Database.Database, runId: string): ObjectModelNpc[] => {
        const rows = database
            .prepare(`
                SELECT
                    id,
                    session_id,
                    run_id,
                    name,
                    bio,
                    description,
                    age,
                    ethnicity,
                    gender,
                    role,
                    species,
                    created_at,
                    modified_at
                FROM npcs
                WHERE run_id = ?
                ORDER BY id ASC
            `)
            .all(runId) as StoredNpcRow[];
        return rows.map(mapNpcRow);
    };

    const loadRun = (
        database: Database.Database,
        runId: string,
        options?: RunLoadOptions,
    ): ObjectModelRun | null => {
        const row = database
            .prepare(`
                SELECT
                    id,
                    session_id,
                    include_party_context,
                    prompt,
                    retrieval_turn_limit,
                    kind,
                    status,
                    created_at,
                    updated_at,
                    started_at,
                    completed_at,
                    failed_at
                FROM runs
                WHERE id = ?
            `)
            .get(runId) as StoredRunRow | undefined;

        if (!row) {
            return null;
        }

        const auditLogs = options?.includeAuditLogs ? loadRunAuditLogs(database, runId) : undefined;
        return mapRunRow(row, auditLogs);
    };

    const loadSession = (
        database: Database.Database,
        sessionId: string,
        options?: SessionLoadOptions,
    ): ObjectModelSession | null => {
        const row = database
            .prepare(`
                SELECT
                    id,
                    kind,
                    title,
                    active_run_id,
                    archived_at,
                    last_entry_at,
                    created_at,
                    updated_at
                FROM sessions
                WHERE id = ?
            `)
            .get(sessionId) as StoredSessionRow | undefined;

        if (!row) {
            return null;
        }

        const entries = loadSessionEntries(database, sessionId);
        const activeRunOptions = options?.includeRunAuditLogs === undefined
            ? undefined
            : { includeAuditLogs: options.includeRunAuditLogs };
        const activeRun = options?.includeActiveRun === false || row.active_run_id === null
            ? null
            : loadRun(database, row.active_run_id, activeRunOptions);

        return mapSessionRow(row, entries, activeRun);
    };

    return {
        loadNpcsByRun,
        loadRun,
        loadRunAuditLogs,
        loadSession,
        loadSessionEntries,
    };
};
