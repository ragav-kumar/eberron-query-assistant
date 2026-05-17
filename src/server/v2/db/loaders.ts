import type Database from 'better-sqlite3';

import type { SessionLoadOptions } from './contract.js';
import { mapRunRow, mapSessionExchangeRow, mapSessionRow } from './mappers.js';
import type {
    Run as ObjectModelRun,
    Session as ObjectModelSession,
    SessionExchange as ObjectModelSessionExchange,
} from './objectModel.js';
import type {
    Run as StoredRunRow,
    Session as StoredSessionRow,
    SessionExchange as StoredSessionExchangeRow,
} from './schema.js';

export interface Loaders {
    loadRun: (database: Database.Database, runId: string) => ObjectModelRun | null;
    loadSession: (database: Database.Database, sessionId: string, options?: SessionLoadOptions) => ObjectModelSession | null;
    loadSessionExchanges: (database: Database.Database, sessionId: string) => ObjectModelSessionExchange[];
}

export const createLoaders = (): Loaders => {
    const loadSessionExchanges = (
        database: Database.Database,
        sessionId: string,
    ): ObjectModelSessionExchange[] => {
        const rows = database
            .prepare(`
                SELECT
                    id,
                    session_id,
                    run_id,
                    exchange_id,
                    sequence_index,
                    kind,
                    content,
                    title,
                    tool_call_id,
                    created_at
                FROM session_exchanges
                WHERE session_id = ?
                ORDER BY sequence_index ASC, id ASC
            `)
            .all(sessionId) as StoredSessionExchangeRow[];

        return rows.map(mapSessionExchangeRow);
    };

    const loadRun = (
        database: Database.Database,
        runId: string,
    ): ObjectModelRun | null => {
        const row = database
            .prepare(`
                SELECT
                    id,
                    session_id,
                    exchange_id,
                    mode,
                    status,
                    prompt,
                    retrieval_turn_limit,
                    include_party_context,
                    error,
                    created_at,
                    updated_at,
                    started_at,
                    completed_at,
                    failed_at
                FROM runs
                WHERE id = ?
            `)
            .get(runId) as StoredRunRow | undefined;

        return row ? mapRunRow(row) : null;
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
                    mode,
                    title,
                    active_run_id,
                    include_party_context,
                    archived_at,
                    created_at,
                    updated_at
                FROM sessions
                WHERE id = ?
            `)
            .get(sessionId) as StoredSessionRow | undefined;

        if (!row) {
            return null;
        }

        const exchanges = options?.includeExchanges === false ? [] : loadSessionExchanges(database, sessionId);
        const activeRun = options?.includeActiveRun === false || row.active_run_id === null
            ? null
            : loadRun(database, row.active_run_id);

        return mapSessionRow(row, exchanges, activeRun);
    };

    return {
        loadRun,
        loadSession,
        loadSessionExchanges,
    };
};
