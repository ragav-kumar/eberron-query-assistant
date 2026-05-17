import type {
    ConsoleEntry as ObjectModelConsoleEntry,
    Npc as ObjectModelNpc,
    RefreshState as ObjectModelRefreshState,
    Run as ObjectModelRun,
    Session as ObjectModelSession,
    SessionExchange as ObjectModelSessionExchange,
    Setting as ObjectModelSetting,
} from './objectModel.js';
import type {
    ConsoleEntry as StoredConsoleEntryRow,
    Npc as StoredNpcRow,
    RefreshState as StoredRefreshStateRow,
    Run as StoredRunRow,
    Session as StoredSessionRow,
    SessionExchange as StoredSessionExchangeRow,
    Setting as StoredSettingRow,
} from './schema.js';

export const toTimestamp = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;

const toDate = (value: string | null): Date | null => value ? new Date(value) : null;

export const mapSettingRow = (row: StoredSettingRow): ObjectModelSetting => ({
        key: row.key,
        modifiedAt: new Date(row.modified_at),
        value: row.value,
    });

export const mapRefreshStateRow = (row: StoredRefreshStateRow): ObjectModelRefreshState => ({
        activeOperation: row.active_operation,
        createdAt: new Date(row.created_at),
        lastRefreshAt: toDate(row.last_refresh_at),
        lastReingestAt: toDate(row.last_reingest_at),
        refreshStatus: row.refresh_status,
        reingestStatus: row.reingest_status,
        updatedAt: new Date(row.updated_at),
    });

export const mapSessionExchangeRow = (row: StoredSessionExchangeRow): ObjectModelSessionExchange => {
    const base = {
        createdAt: new Date(row.created_at),
        exchangeId: row.exchange_id,
        id: row.id,
        runId: row.run_id,
        sequenceIndex: row.sequence_index,
        sessionId: row.session_id,
    };

    switch (row.kind) {
        case 'user':
            return {
                ...base,
                content: row.content,
                kind: 'user',
            };
        case 'reasoning':
            return {
                ...base,
                content: row.content,
                kind: 'reasoning',
                toolCallId: row.tool_call_id,
            };
        case 'response':
            return {
                ...base,
                content: row.content,
                kind: 'response',
                title: row.title ?? undefined,
            };
    }
};

export const mapRunRow = (row: StoredRunRow): ObjectModelRun => ({
        completedAt: toDate(row.completed_at),
        createdAt: new Date(row.created_at),
        error: row.error ?? undefined,
        exchangeId: row.exchange_id,
        failedAt: toDate(row.failed_at),
        id: row.id,
        includePartyContext: row.include_party_context === 1,
        mode: row.mode,
        prompt: row.prompt,
        retrievalTurnLimit: row.retrieval_turn_limit,
        sessionId: row.session_id,
        startedAt: toDate(row.started_at),
        status: row.status,
        updatedAt: new Date(row.updated_at),
    });

export const mapSessionRow = (
    row: StoredSessionRow,
    exchanges: ObjectModelSessionExchange[],
    activeRun: ObjectModelRun | null,
): ObjectModelSession => ({
        activeRun,
        activeRunId: row.active_run_id,
        archivedAt: toDate(row.archived_at),
        createdAt: new Date(row.created_at),
        exchanges,
        id: row.id,
        includePartyContext: row.include_party_context === 1,
        mode: row.mode,
        title: row.title ?? undefined,
        updatedAt: new Date(row.updated_at),
    });

export const mapNpcRow = (row: StoredNpcRow): ObjectModelNpc => ({
        age: row.age ?? undefined,
        bio: row.bio,
        createdAt: toDate(row.created_at),
        description: row.description,
        ethnicity: row.ethnicity ?? undefined,
        gender: row.gender ?? undefined,
        id: row.id,
        name: row.name,
        role: row.role ?? undefined,
        runId: row.run_id,
        sessionId: row.session_id,
        species: row.species ?? undefined,
        updatedAt: toDate(row.updated_at),
    });

export const mapConsoleEntryRow = (row: StoredConsoleEntryRow): ObjectModelConsoleEntry => ({
        createdAt: new Date(row.created_at),
        id: row.id,
        level: row.level,
        message: row.message,
    });
