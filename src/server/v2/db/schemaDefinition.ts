import type Database from 'better-sqlite3';
import {
    sessionModes,
} from '@/types.js';

const refreshOperationKinds = ['refresh', 'reingest'] as const;
const refreshStatuses = ['idle', 'pending', 'running', 'completed', 'failed'] as const;
const runStatuses = ['pending', 'running', 'completed', 'failed'] as const;
const sessionFeedEntryKinds = ['user', 'reasoning', 'response'] as const;

const quoteSqlStrings = (values: readonly string[]): string => {
    return values.map((value) => `'${value}'`).join(', ');
};

const SESSION_MODE_SQL = quoteSqlStrings(sessionModes);
const RUN_STATUS_SQL = quoteSqlStrings(runStatuses);
const REFRESH_OPERATION_SQL = quoteSqlStrings(refreshOperationKinds);
const REFRESH_STATUS_SQL = quoteSqlStrings(refreshStatuses);
const SESSION_EXCHANGE_KIND_SQL = quoteSqlStrings(sessionFeedEntryKinds);

export const createSchema = (database: Database.Database): void => {
    database.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            modified_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS refresh_state (
            singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
            active_operation TEXT CHECK (active_operation IN (${REFRESH_OPERATION_SQL}) OR active_operation IS NULL),
            refresh_status TEXT NOT NULL CHECK (refresh_status IN (${REFRESH_STATUS_SQL})),
            reingest_status TEXT NOT NULL CHECK (reingest_status IN (${REFRESH_STATUS_SQL})),
            last_refresh_at TEXT,
            last_reingest_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            mode TEXT NOT NULL CHECK (mode IN (${SESSION_MODE_SQL})),
            title TEXT,
            active_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
            include_party_context INTEGER NOT NULL CHECK (include_party_context IN (0, 1)),
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            exchange_id TEXT NOT NULL UNIQUE,
            mode TEXT NOT NULL CHECK (mode IN (${SESSION_MODE_SQL})),
            status TEXT NOT NULL CHECK (status IN (${RUN_STATUS_SQL})),
            prompt TEXT NOT NULL,
            retrieval_turn_limit INTEGER NOT NULL,
            include_party_context INTEGER NOT NULL CHECK (include_party_context IN (0, 1)),
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            failed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS session_exchanges (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            exchange_id TEXT NOT NULL,
            sequence_index INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN (${SESSION_EXCHANGE_KIND_SQL})),
            content TEXT NOT NULL,
            title TEXT,
            tool_call_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (exchange_id) REFERENCES runs(exchange_id) ON DELETE CASCADE
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
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS console_entries (
            id TEXT PRIMARY KEY,
            level TEXT NOT NULL CHECK (level IN ('debug', 'error', 'info', 'warn')),
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_exchanges_session_sequence
            ON session_exchanges(session_id, sequence_index, id);

        CREATE INDEX IF NOT EXISTS idx_session_exchanges_run_sequence
            ON session_exchanges(run_id, sequence_index, id);

        CREATE INDEX IF NOT EXISTS idx_npcs_run_id
            ON npcs(run_id, id);

        CREATE INDEX IF NOT EXISTS idx_npcs_session_updated
            ON npcs(session_id, updated_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_npcs_updated
            ON npcs(updated_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_console_entries_created
            ON console_entries(created_at, id);
    `);
};
