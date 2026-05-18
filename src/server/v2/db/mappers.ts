import type {
    ConsoleEntry as ObjectModelConsoleEntry,
    IngestedArticle as ObjectModelIngestedArticle,
    IngestedFile as ObjectModelIngestedFile,
    Npc as ObjectModelNpc,
    RefreshState as ObjectModelRefreshState,
    Run as ObjectModelRun,
    Session as ObjectModelSession,
    SessionExchange as ObjectModelSessionExchange,
    Setting as ObjectModelSetting,
} from './objectModel.js';
import type {
    ConsoleEntry as StoredConsoleEntryRow,
    IngestedArticle as StoredIngestedArticleRow,
    IngestedFile as StoredIngestedFileRow,
    Npc as StoredNpcRow,
    RefreshState as StoredRefreshStateRow,
    Run as StoredRunRow,
    Session as StoredSessionRow,
    SessionExchange as StoredSessionExchangeRow,
    Setting as StoredSettingRow,
} from './inner/schema.js';

export const toTimestamp = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;

const toDate = (value: string | null): Date | null => value ? new Date(value) : null;

export const mapSettingRow = (row: StoredSettingRow): ObjectModelSetting => ({
        key: row.key,
        modifiedAt: new Date(row.modified_at),
        value: row.value,
    });

export const toStoredSettingRow = (setting: ObjectModelSetting): StoredSettingRow => ({
        key: setting.key,
        modified_at: setting.modifiedAt.toISOString(),
        value: setting.value,
    });

export const mapIngestedFileRow = (row: StoredIngestedFileRow): ObjectModelIngestedFile => ({
        filename: row.filename,
        sourceType: row.source_type,
    });

export const toStoredIngestedFileRow = (file: ObjectModelIngestedFile): StoredIngestedFileRow => ({
        filename: file.filename,
        source_type: file.sourceType,
    });

export const mapIngestedArticleRow = (row: StoredIngestedArticleRow): ObjectModelIngestedArticle => ({
        canonicalUrl: row.canonical_url,
        firstSeenAt: new Date(row.first_seen_at),
        lastIngestedAt: new Date(row.last_ingested_at),
        scrapeStatus: row.scrape_status,
        title: row.title ?? undefined,
    });

export const toStoredIngestedArticleRow = (article: ObjectModelIngestedArticle): StoredIngestedArticleRow => ({
        canonical_url: article.canonicalUrl,
        first_seen_at: article.firstSeenAt.toISOString(),
        last_ingested_at: article.lastIngestedAt.toISOString(),
        scrape_status: article.scrapeStatus,
        title: article.title ?? null,
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

export const toStoredRefreshStateRow = (refreshState: ObjectModelRefreshState): StoredRefreshStateRow => ({
        active_operation: refreshState.activeOperation,
        created_at: refreshState.createdAt.toISOString(),
        last_refresh_at: toTimestamp(refreshState.lastRefreshAt),
        last_reingest_at: toTimestamp(refreshState.lastReingestAt),
        refresh_status: refreshState.refreshStatus,
        reingest_status: refreshState.reingestStatus,
        singleton_key: 1,
        updated_at: refreshState.updatedAt.toISOString(),
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

export const toStoredSessionExchangeRow = (exchange: ObjectModelSessionExchange): StoredSessionExchangeRow => {
    switch (exchange.kind) {
        case 'user':
            return {
                content: exchange.content,
                created_at: exchange.createdAt.toISOString(),
                exchange_id: exchange.exchangeId,
                id: exchange.id,
                kind: 'user',
                run_id: exchange.runId,
                sequence_index: exchange.sequenceIndex,
                session_id: exchange.sessionId,
                title: null,
                tool_call_id: null,
            };
        case 'reasoning':
            return {
                content: exchange.content,
                created_at: exchange.createdAt.toISOString(),
                exchange_id: exchange.exchangeId,
                id: exchange.id,
                kind: 'reasoning',
                run_id: exchange.runId,
                sequence_index: exchange.sequenceIndex,
                session_id: exchange.sessionId,
                title: null,
                tool_call_id: exchange.toolCallId,
            };
        case 'response':
            return {
                content: exchange.content,
                created_at: exchange.createdAt.toISOString(),
                exchange_id: exchange.exchangeId,
                id: exchange.id,
                kind: 'response',
                run_id: exchange.runId,
                sequence_index: exchange.sequenceIndex,
                session_id: exchange.sessionId,
                title: exchange.title ?? null,
                tool_call_id: null,
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

export const toStoredRunRow = (run: ObjectModelRun): StoredRunRow => ({
        completed_at: toTimestamp(run.completedAt),
        created_at: run.createdAt.toISOString(),
        error: run.error ?? null,
        exchange_id: run.exchangeId,
        failed_at: toTimestamp(run.failedAt),
        id: run.id,
        include_party_context: run.includePartyContext ? 1 : 0,
        mode: run.mode,
        prompt: run.prompt,
        retrieval_turn_limit: run.retrievalTurnLimit,
        session_id: run.sessionId,
        started_at: toTimestamp(run.startedAt),
        status: run.status,
        updated_at: run.updatedAt.toISOString(),
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

export const toStoredSessionRow = (session: ObjectModelSession): StoredSessionRow => ({
        active_run_id: session.activeRunId,
        archived_at: toTimestamp(session.archivedAt),
        created_at: session.createdAt.toISOString(),
        id: session.id,
        include_party_context: session.includePartyContext ? 1 : 0,
        mode: session.mode,
        title: session.title ?? null,
        updated_at: session.updatedAt.toISOString(),
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

export const toStoredNpcRow = (npc: ObjectModelNpc): StoredNpcRow => ({
        age: npc.age ?? null,
        bio: npc.bio,
        created_at: toTimestamp(npc.createdAt),
        description: npc.description,
        ethnicity: npc.ethnicity ?? null,
        gender: npc.gender ?? null,
        id: npc.id,
        name: npc.name,
        role: npc.role ?? null,
        run_id: npc.runId,
        session_id: npc.sessionId,
        species: npc.species ?? null,
        updated_at: toTimestamp(npc.updatedAt),
    });

export const mapConsoleEntryRow = (row: StoredConsoleEntryRow): ObjectModelConsoleEntry => ({
        createdAt: new Date(row.created_at),
        id: row.id,
        level: row.level,
        message: row.message,
    });

export const toStoredConsoleEntryRow = (entry: ObjectModelConsoleEntry): StoredConsoleEntryRow => ({
        created_at: entry.createdAt.toISOString(),
        id: entry.id,
        level: entry.level,
        message: entry.message,
    });
