import { randomUUID } from 'node:crypto';

import { type Insertable, type Kysely, type Transaction } from 'kysely';

import type { CreateRunDto, RunDto, SessionEntryDto } from '@/dto/index.js';
import { createTaggedError, formatThrownValue } from '@/errors.js';
import { Settings, settingKeys, type AppDatabaseSchema, type SessionEntry, type UpdateRow } from '@/server/v2/db/app/index.js';
import type { AppDb } from '@/server/v2/db/app/db.js';
import type { PartyContextService } from '@/server/v2/db/corpus/party-context.js';
import type { CorpusRetrievalService } from '@/server/v2/db/corpus/retrieval-service.js';
import type { ChatAdapter } from '@/server/v1/provider/index.js';

import {
    buildChatHistoryFromSessionEntries,
    executeAssistantRun,
    loadV2PromptAssets,
    type V2PromptAssets,
} from './run-runtime.js';

export interface RunCoordinator {
    startRun(request: CreateRunDto): Promise<RunDto>;
}

export interface RunCoordinatorDependencies {
    appDb: AppDb;
    chat: ChatAdapter;
    loadPromptAssets?: () => Promise<V2PromptAssets>;
    partyContext: PartyContextService;
    retrieval: CorpusRetrievalService;
    retrievalDir: string;
}

/**
 * Coordinates one persisted V2 run from validation through durable transcript
 * persistence, while keeping all writes on the V2 app-database path.
 */
export const createRunCoordinator = (dependencies: RunCoordinatorDependencies): RunCoordinator => ({
    startRun: async (request) => {
        const normalized = normalizeCreateRunRequest(request);
        const sessionId = normalized.sessionId;
        if (normalized.mode !== 'assistant') {
            throw createTaggedError('run-unsupported-mode', 'Only assistant runs are supported in Phase 1.');
        }
        if (!sessionId) {
            throw createTaggedError('run-session-required', 'A persisted sessionId is required for V2 runs in Phase 1.');
        }

        await assertRunNotBlocked(dependencies.appDb.db);
        await dependencies.retrieval.prepare(dependencies.retrievalDir);

        const runId = randomUUID();
        const promptAssets = await (dependencies.loadPromptAssets ?? loadV2PromptAssets)();
        const now = new Date().toISOString();
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
        const additionalContext = await Settings.read(dependencies.appDb.db, settingKeys.additionalContext) ?? '';
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

        try {
            const assistantResult = await executeAssistantRun({
                additionalContext,
                chat: dependencies.chat,
                history: buildChatHistoryFromSessionEntries(existingEntries),
                includePartyContext: normalized.includePartyContext,
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
                    persistedEntries.push(toSessionEntryDto(entry));
                    nextSequenceIndex += 1;
                },
                partyContext,
                prompt: normalized.prompt,
                promptAssets,
                requestSessionTitle,
                retrieval: dependencies.retrieval,
                retrievalTurnLimit: normalized.retrievalTurnLimit,
                runId,
                sessionId,
            });

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

                const completedAt = new Date().toISOString();
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
        retrievalTurnLimit: Math.min(3, Math.max(0, Math.trunc(request.retrievalTurnLimit))),
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
