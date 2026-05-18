import type Database from 'better-sqlite3';

import type { SessionExchange as StoredSessionExchangeRow } from '../schema.js';

const EXCHANGE_SELECT = `
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
`;

const EXCHANGE_ORDER = 'ORDER BY sequence_index ASC, id ASC';

export const createSessionExchangesRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (id: string) => {
            const database = await getDatabase();
            const row = database
                .prepare<[string], StoredSessionExchangeRow>(`
                    ${EXCHANGE_SELECT}
                    WHERE id = ?
                `)
                .get(id);
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare<[], StoredSessionExchangeRow>(`
                    ${EXCHANGE_SELECT}
                    ${EXCHANGE_ORDER}
                `)
                .all();
        },
        save: async (exchange: StoredSessionExchangeRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO session_exchanges (
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        session_id = excluded.session_id,
                        run_id = excluded.run_id,
                        exchange_id = excluded.exchange_id,
                        sequence_index = excluded.sequence_index,
                        kind = excluded.kind,
                        content = excluded.content,
                        title = excluded.title,
                        tool_call_id = excluded.tool_call_id,
                        created_at = excluded.created_at
                `)
                .run(
                    exchange.id,
                    exchange.session_id,
                    exchange.run_id,
                    exchange.exchange_id,
                    exchange.sequence_index,
                    exchange.kind,
                    exchange.content,
                    exchange.title,
                    exchange.tool_call_id,
                    exchange.created_at,
                );
        },
    });
