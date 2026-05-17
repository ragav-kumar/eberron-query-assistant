import type {
    AdditionalContextDocument,
    ConsoleEntry as ObjectModelConsoleEntry,
    Npc as ObjectModelNpc,
    RefreshState as ObjectModelRefreshState,
    Run as ObjectModelRun,
    Session as ObjectModelSession,
    SessionExchange as ObjectModelSessionExchange,
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

export const ADDITIONAL_CONTEXT_KEY = 'additionalContext';

export const toTimestamp = (value: Date | null | undefined): string | null => {
    return value ? value.toISOString() : null;
};

const toDate = (value: string | null): Date | null => {
    return value ? new Date(value) : null;
};

export const mapSettingRow = (row: StoredSettingRow): AdditionalContextDocument => {
    return {
        markdown: row.value,
        updatedAt: new Date(row.modified_at),
    };
};

export const mapRefreshStateRow = (row: StoredRefreshStateRow): ObjectModelRefreshState => {
    return {
        activeOperation: row.active_operation,
        createdAt: new Date(row.created_at),
        lastRefreshAt: toDate(row.last_refresh_at),
        lastReingestAt: toDate(row.last_reingest_at),
        refreshStatus: row.refresh_status,
        reingestStatus: row.reingest_status,
        updatedAt: new Date(row.updated_at),
    };
};

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
            return row.title === null
                ? {
                    ...base,
                    content: row.content,
                    kind: 'response',
                }
                : {
                ...base,
                content: row.content,
                kind: 'response',
                title: row.title,
            };
    }
};

export const mapRunRow = (row: StoredRunRow): ObjectModelRun => {
    const run: ObjectModelRun = {
        completedAt: toDate(row.completed_at),
        createdAt: new Date(row.created_at),
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
    };

    if (row.error !== null) {
        run.error = row.error;
    }

    return run;
};

export const mapSessionRow = (
    row: StoredSessionRow,
    exchanges: ObjectModelSessionExchange[],
    activeRun: ObjectModelRun | null,
): ObjectModelSession => {
    const session: ObjectModelSession = {
        activeRun,
        activeRunId: row.active_run_id,
        archivedAt: toDate(row.archived_at),
        createdAt: new Date(row.created_at),
        exchanges,
        id: row.id,
        includePartyContext: row.include_party_context === 1,
        mode: row.mode,
        updatedAt: new Date(row.updated_at),
    };

    if (row.title !== null) {
        session.title = row.title;
    }

    return session;
};

export const mapNpcRow = (row: StoredNpcRow): ObjectModelNpc => {
    const npc: ObjectModelNpc = {
        bio: row.bio,
        createdAt: toDate(row.created_at),
        description: row.description,
        id: row.id,
        name: row.name,
        runId: row.run_id,
        sessionId: row.session_id,
        updatedAt: toDate(row.updated_at),
    };

    if (row.age !== null) {
        npc.age = row.age;
    }
    if (row.ethnicity !== null) {
        npc.ethnicity = row.ethnicity;
    }
    if (row.gender !== null) {
        npc.gender = row.gender;
    }
    if (row.role !== null) {
        npc.role = row.role;
    }
    if (row.species !== null) {
        npc.species = row.species;
    }

    return npc;
};

export const mapConsoleEntryRow = (row: StoredConsoleEntryRow): ObjectModelConsoleEntry => {
    return {
        createdAt: new Date(row.created_at),
        id: row.id,
        level: row.level,
        message: row.message,
    };
};
