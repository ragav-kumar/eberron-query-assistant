import type Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase } from './database.js';
import type {
    Npc as ObjectModelNpc,
    Run as ObjectModelRun,
    RunAuditLog as ObjectModelRunAuditLog,
    Session as ObjectModelSession,
    SessionEntry as ObjectModelSessionEntry,
    Setting as ObjectModelSetting,
} from './objectModel.js';
import type {
    Npc as SchemaNpc,
    Run as SchemaRun,
    RunAuditLog as SchemaRunAuditLog,
    Session as SchemaSession,
    SessionEntry as SchemaSessionEntry,
    Setting as SchemaSetting,
} from './schema.js';

type StoredSessionRow = {
    active_run_id: string | null;
    archived_at: string | null;
    created_at: string;
    id: string;
    kind: 'assistant' | 'npc';
    last_entry_at: string | null;
    title: string | null;
    updated_at: string;
};

type StoredSessionEntryRow = {
    content: string | null;
    created_at: string;
    entry_index: number;
    kind: 'user' | 'assistant-response' | 'assistant-tool' | 'system' | 'assistant-npc';
    run_id: string | null;
    session_id: string;
    title: string | null;
};

type StoredRunRow = {
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

type StoredRunAuditLogRow = {
    created_at: string;
    details: string;
    id: string;
    kind: string;
    run_id: string;
};

type StoredNpcRow = {
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

type StoredSettingRow = {
    key: string;
    modified_at: string;
    value: string;
};

export interface V2Orm {
    bootstrap: (config: RuntimeConfig) => Promise<void>;
    close: () => void;
    npcs: {
        get: (config: RuntimeConfig, id: number) => Promise<ObjectModelNpc | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelNpc[]>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<ObjectModelNpc[]>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelNpc[]>;
        save: (config: RuntimeConfig, npc: SchemaNpc) => Promise<void>;
    };
    runAuditLogs: {
        get: (config: RuntimeConfig, id: string) => Promise<ObjectModelRunAuditLog | null>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<ObjectModelRunAuditLog[]>;
        save: (config: RuntimeConfig, auditLog: SchemaRunAuditLog) => Promise<void>;
    };
    runs: {
        get: (config: RuntimeConfig, id: string, options?: { includeAuditLogs?: boolean }) => Promise<ObjectModelRun | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelRun[]>;
        save: (config: RuntimeConfig, run: SchemaRun) => Promise<void>;
    };
    sessionEntries: {
        get: (config: RuntimeConfig, sessionId: string, entryIndex: number) => Promise<ObjectModelSessionEntry | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelSessionEntry[]>;
        save: (config: RuntimeConfig, entry: SchemaSessionEntry) => Promise<void>;
    };
    sessions: {
        get: (
            config: RuntimeConfig,
            id: string,
            options?: { includeActiveRun?: boolean; includeRunAuditLogs?: boolean }
        ) => Promise<ObjectModelSession | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelSession[]>;
        save: (config: RuntimeConfig, session: SchemaSession) => Promise<void>;
    };
    settings: {
        get: (config: RuntimeConfig, key: string) => Promise<ObjectModelSetting | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelSetting[]>;
        save: (config: RuntimeConfig, setting: SchemaSetting) => Promise<void>;
    };
}

const createSchema = (database: Database.Database): void => {
    database.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            modified_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT,
            active_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
            archived_at TEXT,
            last_entry_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            include_party_context INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            retrieval_turn_limit INTEGER NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            failed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS session_entries (
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            entry_index INTEGER NOT NULL,
            run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
            title TEXT,
            kind TEXT NOT NULL,
            content TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (session_id, entry_index)
        );

        CREATE TABLE IF NOT EXISTS run_audit_logs (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            details TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS npcs (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            bio TEXT NOT NULL,
            description TEXT NOT NULL,
            age TEXT,
            ethnicity TEXT,
            gender TEXT,
            role TEXT,
            species TEXT,
            created_at TEXT,
            modified_at TEXT
        );
    `);
};

const toTimestamp = (value: Date | null | undefined): string | null => {
    return value ? value.toISOString() : null;
};

const toDate = (value: string | null): Date | null => {
    return value ? new Date(value) : null;
};

const mapSettingRow = (row: StoredSettingRow): ObjectModelSetting => {
    return {
        key: row.key,
        modifiedAt: new Date(row.modified_at),
        value: row.value,
    };
};

const mapRunAuditLogRow = (row: StoredRunAuditLogRow): ObjectModelRunAuditLog => {
    return {
        createdAt: new Date(row.created_at),
        details: row.details,
        id: row.id,
        kind: row.kind,
        runId: row.run_id,
    };
};

const mapNpcRow = (row: StoredNpcRow): ObjectModelNpc => {
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

const mapRunRow = (row: StoredRunRow, auditLogs?: ObjectModelRunAuditLog[]): ObjectModelRun => {
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

const mapSessionEntryRow = (row: StoredSessionEntryRow, npcs: ObjectModelNpc[]): ObjectModelSessionEntry => {
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

const mapSessionRow = (
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

const createV2Orm = (): V2Orm => {
    const appDatabase = createAppDatabase();

    const getDatabase = async (config: RuntimeConfig): Promise<Database.Database> => {
        const database = await appDatabase.open(config);
        createSchema(database);
        return database;
    };

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
        options?: { includeAuditLogs?: boolean }
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
        options?: { includeActiveRun?: boolean; includeRunAuditLogs?: boolean }
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
        async bootstrap(config) {
            await getDatabase(config);
        },
        close() {
            appDatabase.close();
        },
        npcs: {
            async get(config, id) {
                const database = await getDatabase(config);
                const row = database
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
                        WHERE id = ?
                    `)
                    .get(id) as StoredNpcRow | undefined;
                return row ? mapNpcRow(row) : null;
            },
            async list(config) {
                const database = await getDatabase(config);
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
                        ORDER BY id ASC
                    `)
                    .all() as StoredNpcRow[];
                return rows.map(mapNpcRow);
            },
            async listByRun(config, runId) {
                const database = await getDatabase(config);
                return loadNpcsByRun(database, runId);
            },
            async listBySession(config, sessionId) {
                const database = await getDatabase(config);
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
                return rows.map(mapNpcRow);
            },
            async save(config, npc) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO npcs (
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
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            session_id = excluded.session_id,
                            run_id = excluded.run_id,
                            name = excluded.name,
                            bio = excluded.bio,
                            description = excluded.description,
                            age = excluded.age,
                            ethnicity = excluded.ethnicity,
                            gender = excluded.gender,
                            role = excluded.role,
                            species = excluded.species,
                            created_at = excluded.created_at,
                            modified_at = excluded.modified_at
                    `)
                    .run(
                        npc.id,
                        npc.sessionId,
                        npc.runId,
                        npc.name,
                        npc.bio,
                        npc.description,
                        npc.age ?? null,
                        npc.ethnicity ?? null,
                        npc.gender ?? null,
                        npc.role ?? null,
                        npc.species ?? null,
                        toTimestamp(npc.createdAt),
                        toTimestamp(npc.modifiedAt),
                    );
            },
        },
        runAuditLogs: {
            async get(config, id) {
                const database = await getDatabase(config);
                const row = database
                    .prepare(`
                        SELECT id, run_id, kind, details, created_at
                        FROM run_audit_logs
                        WHERE id = ?
                    `)
                    .get(id) as StoredRunAuditLogRow | undefined;
                return row ? mapRunAuditLogRow(row) : null;
            },
            async listByRun(config, runId) {
                const database = await getDatabase(config);
                return loadRunAuditLogs(database, runId);
            },
            async save(config, auditLog) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO run_audit_logs (id, run_id, kind, details, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            run_id = excluded.run_id,
                            kind = excluded.kind,
                            details = excluded.details,
                            created_at = excluded.created_at
                    `)
                    .run(
                        auditLog.id,
                        auditLog.runId,
                        auditLog.kind,
                        auditLog.details,
                        auditLog.createdAt.toISOString(),
                    );
            },
        },
        runs: {
            async get(config, id, options) {
                const database = await getDatabase(config);
                return loadRun(database, id, options);
            },
            async listBySession(config, sessionId) {
                const database = await getDatabase(config);
                const rows = database
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
                        WHERE session_id = ?
                        ORDER BY created_at ASC, id ASC
                    `)
                    .all(sessionId) as StoredRunRow[];
                return rows.map((row) => mapRunRow(row));
            },
            async save(config, run) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO runs (
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
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            session_id = excluded.session_id,
                            include_party_context = excluded.include_party_context,
                            prompt = excluded.prompt,
                            retrieval_turn_limit = excluded.retrieval_turn_limit,
                            kind = excluded.kind,
                            status = excluded.status,
                            created_at = excluded.created_at,
                            updated_at = excluded.updated_at,
                            started_at = excluded.started_at,
                            completed_at = excluded.completed_at,
                            failed_at = excluded.failed_at
                    `)
                    .run(
                        run.id,
                        run.sessionId,
                        run.includePartyContext ? 1 : 0,
                        run.prompt,
                        run.retrievalTurnLimit,
                        run.kind,
                        run.status,
                        run.createdAt.toISOString(),
                        run.updatedAt.toISOString(),
                        toTimestamp(run.startedAt),
                        toTimestamp(run.completedAt),
                        toTimestamp(run.failedAt),
                    );
            },
        },
        sessionEntries: {
            async get(config, sessionId, entryIndex) {
                const database = await getDatabase(config);
                const row = database
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
                        WHERE session_id = ? AND entry_index = ?
                    `)
                    .get(sessionId, entryIndex) as StoredSessionEntryRow | undefined;
                if (!row) {
                    return null;
                }

                const npcs = row.run_id ? loadNpcsByRun(database, row.run_id) : [];
                return mapSessionEntryRow(row, npcs);
            },
            async listBySession(config, sessionId) {
                const database = await getDatabase(config);
                return loadSessionEntries(database, sessionId);
            },
            async save(config, entry) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO session_entries (
                            session_id,
                            entry_index,
                            run_id,
                            title,
                            kind,
                            content,
                            created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(session_id, entry_index) DO UPDATE SET
                            run_id = excluded.run_id,
                            title = excluded.title,
                            kind = excluded.kind,
                            content = excluded.content,
                            created_at = excluded.created_at
                    `)
                    .run(
                        entry.sessionId,
                        entry.entryIndex,
                        entry.runId ?? null,
                        entry.title ?? null,
                        entry.kind,
                        entry.content ?? null,
                        entry.createdAt.toISOString(),
                    );
            },
        },
        sessions: {
            async get(config, id, options) {
                const database = await getDatabase(config);
                return loadSession(database, id, options);
            },
            async list(config) {
                const database = await getDatabase(config);
                const rows = database
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
                        ORDER BY created_at ASC, id ASC
                    `)
                    .all() as StoredSessionRow[];

                return rows.map((row) => {
                    const entries = loadSessionEntries(database, row.id);
                    const activeRun = row.active_run_id ? loadRun(database, row.active_run_id) : null;
                    return mapSessionRow(row, entries, activeRun);
                });
            },
            async save(config, session) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO sessions (
                            id,
                            kind,
                            title,
                            active_run_id,
                            archived_at,
                            last_entry_at,
                            created_at,
                            updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            kind = excluded.kind,
                            title = excluded.title,
                            active_run_id = excluded.active_run_id,
                            archived_at = excluded.archived_at,
                            last_entry_at = excluded.last_entry_at,
                            created_at = excluded.created_at,
                            updated_at = excluded.updated_at
                    `)
                    .run(
                        session.id,
                        session.kind,
                        session.title ?? null,
                        session.activeRunId ?? null,
                        toTimestamp(session.archivedAt),
                        toTimestamp(session.lastEntryAt),
                        session.createdAt.toISOString(),
                        session.updatedAt.toISOString(),
                    );
            },
        },
        settings: {
            async get(config, key) {
                const database = await getDatabase(config);
                const row = database
                    .prepare(`
                        SELECT key, value, modified_at
                        FROM settings
                        WHERE key = ?
                    `)
                    .get(key) as StoredSettingRow | undefined;
                return row ? mapSettingRow(row) : null;
            },
            async list(config) {
                const database = await getDatabase(config);
                const rows = database
                    .prepare(`
                        SELECT key, value, modified_at
                        FROM settings
                        ORDER BY key ASC
                    `)
                    .all() as StoredSettingRow[];
                return rows.map(mapSettingRow);
            },
            async save(config, setting) {
                const database = await getDatabase(config);
                database
                    .prepare(`
                        INSERT INTO settings (key, value, modified_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT(key) DO UPDATE SET
                            value = excluded.value,
                            modified_at = excluded.modified_at
                    `)
                    .run(setting.key, setting.value, setting.modifiedAt.toISOString());
            },
        },
    };
};

export { createV2Orm };
