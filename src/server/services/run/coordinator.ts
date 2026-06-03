import { randomUUID } from 'node:crypto';

import { Insertable, Kysely, Transaction } from 'kysely';

import { CreateRunDto, RunDto, SessionDto, SessionEntryDto, SessionEntryReasoningDto, SessionMode } from '@/dto/index.js';
import { createTaggedError, formatThrownValue } from '@/errors.js';
import { settingsStore, AppDatabaseSchema, SessionEntry, UpdateRow } from '@server/db/app/index.js';
import { AppDb } from '@server/db/app/db.js';
import { PartyContextService } from '@server/db/corpus/party-context.js';
import { CorpusRetrievalService } from '@server/db/corpus/retrieval-service.js';

import {
    AssistantRunResult,
    buildChatHistoryFromSessionEntries,
    executeAssistantRun,
    loadPromptAssets,
} from './runtime.js';
import { executeNpcRun, loadNpcPromptAssets, NpcRunResult, ParsedNpcData } from './runtime-npc.js';
import { ChatAdapter } from '../provider/index.js';
import { RuntimeEventPublisher } from '../events/index.js';

export interface RunCoordinator {
    startRun(request: CreateRunDto): Promise<RunDto>;
    /** Resolves when any in-flight background run execution has finished. Used in tests to drain async work before assertions. */
    drain(): Promise<void>;
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
 *
 * The fast path (validation, session setup, initial DB writes, first SSE events)
 * completes synchronously before the HTTP response is sent. Model execution runs
 * in a fire-and-forget background path and publishes remaining SSE events as it
 * progresses.
 */
export const createRunCoordinator = (dependencies: RunCoordinatorDependencies): RunCoordinator => {
    let backgroundWork: Promise<void> | null = null;

    return {
        startRun: async (request) => {
            const normalized = normalizeCreateRunRequest(request);

            await assertRunNotBlocked(dependencies.appDb.db);
            await dependencies.retrieval.prepare(dependencies.retrievalDir);

            const runId = randomUUID();
            const now = new Date().toISOString();
            const settings = settingsStore();
            const additionalContext = settings.read('additionalContext');
            const partyContext = normalized.includePartyContext
                ? await dependencies.partyContext.build(dependencies.retrievalDir)
                : '';

            // All session setup and run writes are inside a single transaction so
            // a new session insert is never left stranded if a later write fails.
            let sessionId!: string;
            let originalSessionTitle!: string;
            let existingEntries!: SessionEntry[];
            let nextSequenceIndex!: number;
            let requestSessionTitle!: boolean;
            let userEntryDto!: SessionEntryDto;

            await dependencies.appDb.db.transaction().execute(async trx => {
                sessionId = normalized.sessionId ?? await insertNewSession(trx, normalized.mode, normalized.includePartyContext, now);
                const session = await trx
                    .selectFrom('sessions')
                    .selectAll()
                    .where('id', '=', sessionId)
                    .executeTakeFirst();
                if (!session) {
                    throw createTaggedError('run-session-missing', `Session "${sessionId}" does not exist.`);
                }
                if (session.mode !== normalized.mode) {
                    throw createTaggedError('run-session-mode-mismatch', `Session "${sessionId}" does not support ${normalized.mode} runs.`);
                }
                originalSessionTitle = session.title;

                existingEntries = await trx
                    .selectFrom('sessionEntries')
                    .selectAll()
                    .where('sessionId', '=', sessionId)
                    .orderBy('sequenceIndex', 'asc')
                    .execute();
                nextSequenceIndex = (existingEntries.at(-1)?.sequenceIndex ?? 0) + 1;
                requestSessionTitle = existingEntries.filter(entry => entry.kind === 'response').length === 0;

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
                nextSequenceIndex += 1;
                userEntryDto = toSessionEntryDto(userEntry);
            });

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
                resourceId: userEntryDto.id,
                sessionId,
                runId,
                entry: userEntryDto,
                timestamp: now,
            });

            backgroundWork = executeRunBackground({
                additionalContext,
                chat: dependencies.chat,
                db: dependencies.appDb.db,
                existingEntries,
                nextSequenceIndex,
                normalized,
                originalSessionTitle,
                partyContext,
                requestSessionTitle,
                retrieval: dependencies.retrieval,
                runtimeEvents: dependencies.runtimeEvents,
                runId,
                sessionId,
            }).finally(() => {
                backgroundWork = null;
            });
            void backgroundWork;

            return {
                createdAt: now,
                id: runId,
                mode: normalized.mode,
                sessionEntries: [userEntryDto],
                sessionId,
                status: 'running',
                updatedAt: now,
            };
        },

        drain: () => backgroundWork ?? Promise.resolve(),
    };
};

interface BackgroundRunInputs {
    additionalContext: string;
    chat: ChatAdapter;
    db: Kysely<AppDatabaseSchema>;
    existingEntries: SessionEntry[];
    nextSequenceIndex: number;
    normalized: CreateRunDto & { prompt: string; retrievalTurnLimit: number };
    originalSessionTitle: string;
    partyContext: string;
    requestSessionTitle: boolean;
    retrieval: CorpusRetrievalService;
    runtimeEvents: RuntimeEventPublisher;
    runId: string;
    sessionId: string;
}

/**
 * Executes the slow path of a run (model execution, reasoning persistence, final
 * writes) after the HTTP response has already been sent. All progress and
 * completion state is communicated to connected clients exclusively via SSE.
 * Errors are persisted and published via SSE; they are not re-thrown.
 */
const executeRunBackground = async (inputs: BackgroundRunInputs): Promise<void> => {
    const {
        additionalContext,
        chat,
        db,
        existingEntries,
        normalized,
        originalSessionTitle,
        partyContext,
        requestSessionTitle,
        retrieval,
        runtimeEvents,
        runId,
        sessionId,
    } = inputs;

    let nextSequenceIndex = inputs.nextSequenceIndex;

    try {
        const onReasoning = async (reasoning: Omit<SessionEntryReasoningDto, 'id'>) => {
            const entry = await db.transaction().execute(async trx => appendSessionEntry(trx, {
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
            nextSequenceIndex += 1;
            runtimeEvents.publish({
                resource: 'session-entry',
                action: 'appended',
                resourceId: reasoningEntry.id,
                sessionId,
                runId,
                entry: reasoningEntry,
                timestamp: reasoningEntry.createdAt,
            });
        };
        const runHistory = buildChatHistoryFromSessionEntries(existingEntries);
        const sharedRunInputs = {
            additionalContext,
            history: runHistory,
            includePartyContext: normalized.includePartyContext,
            partyContext,
            prompt: normalized.prompt,
            requestSessionTitle,
            retrievalTurnLimit: normalized.retrievalTurnLimit,
        };
        const sharedRunServices = { chat, retrieval };
        const sharedRunContext = { runId, sessionId };

        let runResult: AssistantRunResult;
        if (normalized.mode === 'npc') {
            const npcPromptAssets = await loadNpcPromptAssets();
            runResult = await executeNpcRun({
                callbacks: { onReasoning },
                context: sharedRunContext,
                inputs: { ...sharedRunInputs, promptAssets: npcPromptAssets },
                services: sharedRunServices,
            });
        } else {
            const assistantPromptAssets = await loadPromptAssets();
            runResult = await executeAssistantRun({
                callbacks: { onReasoning },
                context: sharedRunContext,
                inputs: { ...sharedRunInputs, promptAssets: assistantPromptAssets },
                services: sharedRunServices,
            });
        }

        const completedAt = new Date().toISOString();
        let responseEntryDto!: SessionEntryDto;
        await db.transaction().execute(async trx => {
            const responseEntry = await appendSessionEntry(trx, {
                content: runResult.response.content,
                createdAt: runResult.response.createdAt,
                kind: 'response',
                runId,
                sequenceIndex: nextSequenceIndex,
                sessionId,
                title: runResult.response.title ?? null,
                toolCallId: null,
            });
            responseEntryDto = toSessionEntryDto(responseEntry);

            // NPC mode: persist the structured NPC records generated in this run
            if (normalized.mode === 'npc') {
                const npcResult = runResult as NpcRunResult;
                for (const npc of npcResult.npcs) {
                    await persistNpc(trx, npc, sessionId, runId, completedAt);
                }
            }

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
                    title: requestSessionTitle && runResult.sessionTitle ? runResult.sessionTitle : originalSessionTitle,
                    updatedAt: completedAt,
                })
                .where('id', '=', sessionId)
                .execute();
        });
        const updatedSessionDto = await fetchSessionDto(db, sessionId);
        runtimeEvents.publish({
            resource: 'session-entry',
            action: 'appended',
            resourceId: responseEntryDto.id,
            sessionId,
            runId,
            entry: responseEntryDto,
            timestamp: completedAt,
        });
        runtimeEvents.publish({
            resource: 'run',
            action: 'completed',
            resourceId: runId,
            sessionId,
            status: 'completed',
            timestamp: completedAt,
        });
        runtimeEvents.publish({
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
        await db
            .updateTable('runs')
            .set({
                error: formatThrownValue(error),
                failedAt,
                status: 'failed',
                updatedAt: failedAt,
            })
            .where('id', '=', runId)
            .execute();
        await db
            .updateTable('sessions')
            .set({
                activeRunId: null,
                updatedAt: failedAt,
            })
            .where('id', '=', sessionId)
            .execute();
        const failedSessionDto = await fetchSessionDto(db, sessionId);
        runtimeEvents.publish({
            resource: 'run',
            action: 'failed',
            resourceId: runId,
            sessionId,
            status: 'failed',
            timestamp: failedAt,
        });
        runtimeEvents.publish({
            resource: 'session',
            action: 'updated',
            resourceId: sessionId,
            sessionId,
            mode: failedSessionDto.mode,
            state: failedSessionDto,
            timestamp: failedAt,
        });
    }
};

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
 * Called within the run transaction when no sessionId is provided so the
 * session insert and all run writes are committed atomically. includePartyContext
 * is set from the run request so it is never null on the new session.
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
 * Inserts or updates one NPC row based on the model-provided ID.
 *
 * - Same-session ID match → update the existing row (model is revising its own NPC).
 * - Unknown ID → insert with the explicit ID so the model can reference it in future turns.
 * - Cross-session ID conflict → insert without the model ID (auto-assign) to protect the other session's row.
 * - No model ID → insert without an explicit ID (auto-assign).
 */
const persistNpc = async (
    trx: Transaction<AppDatabaseSchema>,
    npc: ParsedNpcData,
    sessionId: string,
    runId: string,
    completedAt: string,
): Promise<void> => {
    const fields = {
        age: npc.age ?? null,
        bio: npc.bio,
        description: npc.description,
        ethnicity: npc.ethnicity ?? null,
        gender: npc.gender ?? null,
        name: npc.name,
        role: npc.role ?? null,
        species: npc.species ?? null,
        updatedAt: completedAt,
    };

    if (npc.id != null) {
        const existing = await trx
            .selectFrom('npcs')
            .select(['id', 'sessionId'])
            .where('id', '=', npc.id)
            .executeTakeFirst();

        if (existing != null && existing.sessionId === sessionId) {
            await trx.updateTable('npcs').set({ ...fields, runId }).where('id', '=', npc.id).execute();
            return;
        }

        if (existing == null) {
            await trx.insertInto('npcs').values({ id: npc.id, sessionId, runId, createdAt: completedAt, ...fields }).execute();
            return;
        }

        // Model ID belongs to a different session — fall through to auto-assigned insert.
    }

    await trx.insertInto('npcs').values({ sessionId, runId, createdAt: completedAt, ...fields }).execute();
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
