import type { Orm } from '../../contract.js';
import { mapSessionExchangeRow } from '../../mappers.js';
import type { SessionExchange as StoredSessionExchangeRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type SessionExchangesRepository = Orm['sessionExchanges'];

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
    { getDatabase }: RepositoryDependencies,
): SessionExchangesRepository => ({
        get: async id => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    ${EXCHANGE_SELECT}
                    WHERE id = ?
                `)
                .get(id) as StoredSessionExchangeRow | undefined;
            return row ? mapSessionExchangeRow(row) : null;
        },
        listBySession: async sessionId => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    ${EXCHANGE_SELECT}
                    WHERE session_id = ?
                    ${EXCHANGE_ORDER}
                `)
                .all(sessionId) as StoredSessionExchangeRow[];
            return rows.map(mapSessionExchangeRow);
        },
        listByRun: async runId => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    ${EXCHANGE_SELECT}
                    WHERE run_id = ?
                    ${EXCHANGE_ORDER}
                `)
                .all(runId) as StoredSessionExchangeRow[];
            return rows.map(mapSessionExchangeRow);
        },
        save: async exchange => {
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
                    exchange.sessionId,
                    exchange.runId,
                    exchange.exchangeId,
                    exchange.sequenceIndex,
                    exchange.kind,
                    exchange.content,
                    exchange.kind === 'response' ? (exchange.title ?? null) : null,
                    exchange.kind === 'reasoning' ? exchange.toolCallId : null,
                    exchange.createdAt.toISOString(),
                );
        },
    });
