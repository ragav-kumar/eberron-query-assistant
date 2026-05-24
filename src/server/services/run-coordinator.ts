import { randomUUID } from 'node:crypto';

import { Insertable, Kysely, Transaction } from 'kysely';

import { CreateRunDto, RunDto, SessionDto, SessionEntryDto, SessionMode } from '@/dto/index.js';
import { createTaggedError, formatThrownValue } from '@/errors.js';
import { settingsStore, AppDatabaseSchema, SessionEntry, UpdateRow } from '@server/db/app/index.js';
import { AppDb } from '@server/db/app/db.js';
import { PartyContextService } from '@server/db/corpus/party-context.js';
import { CorpusRetrievalService } from '@server/db/corpus/retrieval-service.js';

import {
    buildChatHistoryFromSessionEntries,
    executeAssistantRun,
    loadPromptAssets,
} from './run-runtime.js';
import { ChatAdapter } from './provider.js';
import { RuntimeEventPublisher } from './runtime-event-publisher.js';

export interface RunCoordinator {
    startRun(request: CreateRunDto): Promise<RunDto>;
}

export interface RunCoordinatorDependencies {
    appDb: AppDb;
    chat: ChatAdapter;
    partyContext: PartyContextService;
    retrieval: CorpusRetrievalService;
    retrievalDir: string;
    runtimeEvents: RuntimeEventPublisher;
}

/**
 * Coordinates one persisted V2 run from validation through durable transcript
 * persistence, while keeping all writes on the V2 app-database path.
 */
export const createRunCoordinator = (dependencies: RunCoordinatorDependencies): RunCoordinator => ({
    startRun: async (request) => {
        const normalized = normalizeCreateRunRequest(request);
        if (normalized.mode !== 'assistant') {
            throw createTaggedError('run-unsupported-mode', 'Only assistant runs are supported in Phase 1.');
        }

        await assertRunNotBlocked(dependencies.appDb.db);
        await dependencies.retrieval.prepare(dependencies.retrievalDir);

        const runId = randomUUID();
        const promptAssets = await loadPromptAssets();
        const now = new Date().toISOString();
        const sessionId = normalized.sessionId ?? await insertNewSession(dependencies.appDb.db, normalized.mode, normalized.includePartyContext, now);
        const persistedEntries: SessionEntryDto[] = [];
        const session = await dependencies.appDb.db
            .selectFrom('sessions')
            .selectAll()
            .where('id', '=', sessionId)
            .executeTakeFirst();
        if (!session) {
            throw createTaggedError('run-session-missing', `Session "${sessionId}" does not exist.`);
        }
        if (session.mode !== 'assistant') {
            throw createTaggedError('run-session-mode-mismatch', `Session "${sessionId}" does not support assistant runs.`);
        }

        const existingEntries = await dependencies.appDb.db
            .selectFrom('sessionEntries')
            .selectAll()
            .where('sessionId', '=', sessionId)
            .orderBy('sequenceIndex', 'asc')
            .execute();
        let nextSequenceIndex = (existingEntries.at(-1)?.sequenceIndex ?? 0) + 1;
        const requestSessionTitle = existingEntries.filter(entry => entry.kind === 'response').length === 0;
        const settings = settingsStore();
        const additionalContext = settings.read('additionalContext');
        const partyContext = normalized.includePartyContext
            ? await dependencies.partyContext.build(dependencies.retrievalDir)
            : '';

        await dependencies.appDb.db.transaction().execute(async trx => {
            await insertRun(trx, {
                createdAt: now,
                id: runId,
                includePartyContext: normalized.includePartyContext ? 1 : 0,
                mode: normalized.mode,
                prompt: normalized.prompt,
                retrievalTurnLimit: normalized.retrievalTurnLimit,
                sessionId,
                startedAt: now,
                status: 'running',
                updatedAt: now,
            });
            await updateSessionForRunningRun(trx, sessionId, runId, {
                includePartyContext: normalized.includePartyContext ? 1 : 0,
                updatedAt: now,
            });
            const userEntry = await appendSessionEntry(trx, {
                content: normalized.prompt,
                createdAt: now,
                kind: 'user',
                runId,
                sequenceIndex: nextSequenceIndex,
                sessionId,
                title: null,
                toolCallId: null,
            });
            persistedEntries.push(toSessionEntryDto(userEntry));
        });
        nextSequenceIndex += 1;
        const startedUserEntry = persistedEntries[0]!;
        dependencies.runtimeEvents.publish({
            resource: 'run',
            action: 'created',
            resourceId: runId,
            sessionId,
            status: 'running',
            timestamp: now,
        });
        dependencies.runtimeEvents.publish({
            resource: 'session-entry',
            action: 'appended',
            resourceId: startedUserEntry.id,
            sessionId,
            runId,
            entry: startedUserEntry,
            timestamp: now,
        });

        try {
            const assistantResult = await executeAssistantRun({
                callbacks: {
                    onReasoning: async reasoning => {
                        const entry = await dependencies.appDb.db.transaction().execute(async trx => appendSessionEntry(trx, {
                            content: reasoning.content,
                            createdAt: reasoning.createdAt,
                            kind: 'reasoning',
                            runId,
                            sequenceIndex: nextSequenceIndex,
                            sessionId,
                            title: null,
                            toolCallId: reasoning.toolCallId,
                        }));
                        const reasoningEntry = toSessionEntryDto(entry);
                        persistedEntries.push(reasoningEntry);
                        nextSequenceIndex += 1;
                        dependencies.runtimeEvents.publish({
                            resource: 'session-entry',
                            action: 'appended',
                            resourceId: reasoningEntry.id,
                            sessionId,
                            runId,
                            entry: reasoningEntry,
                            timestamp: reasoningEntry.createdAt,
                        });
                    },
                },
                context: {
                    runId,
                    sessionId,
                },
                inputs: {
                    additionalContext,
                    history: buildChatHistoryFromSessionEntries(existingEntries),
                    includePartyContext: normalized.includePartyContext,
                    partyContext,
                    prompt: normalized.prompt,
                    promptAssets,
                    requestSessionTitle,
                    retrievalTurnLimit: normalized.retrievalTurnLimit,
                },
                services: {
                    chat: dependencies.chat,
                    retrieval: dependencies.retrieval,
                },
            });

            const completedAt = new Date().toISOString();
            await dependencies.appDb.db.transaction().execute(async trx => {
                const responseEntry = await appendSessionEntry(trx, {
                    content: assistantResult.response.content,
                    createdAt: assistantResult.response.createdAt,
                    kind: 'response',
                    runId,
                    sequenceIndex: nextSequenceIndex,
                    sessionId,
                    title: assistantResult.response.title ?? null,
                    toolCallId: null,
                });
                persistedEntries.push(toSessionEntryDto(responseEntry));

                await trx
                    .updateTable('runs')
                    .set({
                        completedAt,
                        status: 'completed',
                        updatedAt: completedAt,
                    })
                    .where('id', '=', runId)
                    .execute();
                await trx
                    .updateTable('sessions')
                    .set({
                        activeRunId: null,
                        title: requestSessionTitle && assistantResult.sessionTitle ? assistantResult.sessionTitle : session.title,
                        updatedAt: completedAt,
                    })
                    .where('id', '=', sessionId)
                    .execute();
            });
            const responseEntry = persistedEntries.at(-1)!;
            const updatedSessionDto = await fetchSessionDto(dependencies.appDb.db, sessionId);
            dependencies.runtimeEvents.publish({
                resource: 'session-entry',
                action: 'appended',
                resourceId: responseEntry.id,
                sessionId,
                runId,
                entry: responseEntry,
                timestamp: completedAt,
            });
            dependencies.runtimeEvents.publish({
                resource: 'run',
                action: 'completed',
                resourceId: runId,
                sessionId,
                status: 'completed',
                timestamp: completedAt,
            });
            dependencies.runtimeEvents.publish({
                resource: 'session',
                action: 'updated',
                resourceId: sessionId,
                sessionId,
                mode: updatedSessionDto.mode,
                state: updatedSessionDto,
                timestamp: completedAt,
            });
        } catch (error) {
            const failedAt = new Date().toISOString();
            await dependencies.appDb.db
                .updateTable('runs')
                .set({
                    error: formatThrownValue(error),
                    failedAt,
                    status: 'failed',
                    updatedAt: failedAt,
                })
                .where('id', '=', runId)
                .execute();
            await dependencies.appDb.db
                .updateTable('sessions')
                .set({
                    activeRunId: null,
                    updatedAt: failedAt,
                })
                .where('id', '=', sessionId)
                .execute();
            const failedSessionDto = await fetchSessionDto(dependencies.appDb.db, sessionId);
            dependencies.runtimeEvents.publish({
                resource: 'run',
                action: 'failed',
                resourceId: runId,
                sessionId,
                status: 'failed',
                timestamp: failedAt,
            });
            dependencies.runtimeEvents.publish({
                resource: 'session',
                action: 'updated',
                resourceId: sessionId,
                sessionId,
                mode: failedSessionDto.mode,
                state: failedSessionDto,
                timestamp: failedAt,
            });
            throw error;
        }

        const run = await dependencies.appDb.db
            .selectFrom('runs')
            .selectAll()
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();

        return {
            createdAt: run.startedAt ?? undefined,
            error: run.error ?? undefined,
            failedAt: run.failedAt ?? undefined,
            id: run.id,
            mode: run.mode,
            sessionEntries: persistedEntries,
            sessionId: run.sessionId,
            status: run.status,
            updatedAt: run.updatedAt,
        };
    },
});

const normalizeCreateRunRequest = (request: CreateRunDto): CreateRunDto & { prompt: string; retrievalTurnLimit: number } => {
    const prompt = request.prompt.trim();
    if (prompt.length === 0) {
        throw createTaggedError('run-prompt-empty', 'Assistant prompt cannot be empty.');
    }

    return {
        ...request,
        prompt,
        retrievalTurnLimit: Math.min(
            settingsStore().read('retrievalMaxToolTurns'),
            Math.max(0, Math.trunc(request.retrievalTurnLimit)),
        ),
    };
};

const assertRunNotBlocked = async (db: Kysely<AppDatabaseSchema>): Promise<void> => {
    const refreshState = await db
        .selectFrom('refreshState')
        .selectAll()
        .where('singletonKey', '=', 1)
        .executeTakeFirst();
    if (!refreshState) {
        return;
    }

    if (
        refreshState.activeOperation != null ||
        refreshState.refreshStatus === 'running' ||
        refreshState.reingestStatus === 'running'
    ) {
        throw createTaggedError('run-blocked-refresh', 'Runs are blocked while refresh or reingest is active.');
    }
};

const insertRun = async (
    trx: Transaction<AppDatabaseSchema>,
    run: Insertable<AppDatabaseSchema['runs']> & { startedAt: string; status: 'running' },
): Promise<void> => {
    await trx.insertInto('runs').values({
        completedAt: null,
        error: null,
        failedAt: null,
        ...run,
    }).execute();
};

const updateSessionForRunningRun = async (
    trx: Transaction<AppDatabaseSchema>,
    sessionId: string,
    runId: string,
    updates: Pick<UpdateRow<'sessions'>, 'includePartyContext' | 'updatedAt'>,
): Promise<void> => {
    await trx
        .updateTable('sessions')
        .set({
            activeRunId: runId,
            includePartyContext: updates.includePartyContext,
            updatedAt: updates.updatedAt,
        })
        .where('id', '=', sessionId)
        .execute();
};

const appendSessionEntry = async (
    trx: Transaction<AppDatabaseSchema>,
    entry: Omit<Insertable<AppDatabaseSchema['sessionEntries']>, 'id'>,
): Promise<SessionEntry> => {
    const id = randomUUID();
    await trx.insertInto('sessionEntries').values({
        id,
        ...entry,
    }).execute();

    return {
        id,
        content: entry.content,
        createdAt: entry.createdAt,
        kind: entry.kind,
        runId: entry.runId,
        sequenceIndex: entry.sequenceIndex,
        sessionId: entry.sessionId,
        title: entry.title ?? null,
        toolCallId: entry.toolCallId ?? null,
    };
};

const toSessionEntryDto = (entry: SessionEntry): SessionEntryDto => ({
    content: entry.content,
    createdAt: entry.createdAt,
    id: entry.id,
    kind: entry.kind,
    runId: entry.runId,
    sessionId: entry.sessionId,
    title: entry.title ?? undefined,
    toolCallId: entry.toolCallId,
});

/**
 * Inserts a new session row and returns its generated ID.
 * Called when a run arrives without a sessionId so that a durable session
 * exists before the transaction writes begin. includePartyContext is set
 * immediately from the run request so it is never null.
 */
const insertNewSession = async (
    db: Kysely<AppDatabaseSchema>,
    mode: SessionMode,
    includePartyContext: boolean,
    now: string,
): Promise<string> => {
    const id = randomUUID();
    await db.insertInto('sessions').values({
        activeRunId: null,
        archivedAt: null,
        createdAt: now,
        id,
        includePartyContext: includePartyContext ? 1 : 0,
        mode,
        title: '',
        updatedAt: now,
    }).execute();
    return id;
};

/**
 * Fetches a single session as a SessionDto, including the aggregate entry count
 * required for session event state payloads.
 */
const fetchSessionDto = async (db: Kysely<AppDatabaseSchema>, sessionId: string): Promise<SessionDto> => {
    const row = await db
        .selectFrom('sessions')
        .leftJoin('runs', 'sessions.id', 'runs.sessionId')
        .select(({ fn }) => [
            'sessions.id',
            'sessions.mode',
            'sessions.title',
            'sessions.activeRunId',
            'sessions.includePartyContext',
            'sessions.createdAt',
            'sessions.updatedAt',
            fn.count('runs.id').as('runCount'),
        ])
        .where('sessions.id', '=', sessionId)
        .groupBy([
            'sessions.id',
            'sessions.mode',
            'sessions.title',
            'sessions.activeRunId',
            'sessions.includePartyContext',
            'sessions.createdAt',
            'sessions.updatedAt',
        ])
        .executeTakeFirstOrThrow();

    return {
        ...row,
        runCount: row.runCount as number,
        includePartyContext: row.includePartyContext == null ? null : !!row.includePartyContext,
    };
};
