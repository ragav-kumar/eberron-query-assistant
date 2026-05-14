import type Database from 'better-sqlite3';

export const createSchema = (database: Database.Database): void => {
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
