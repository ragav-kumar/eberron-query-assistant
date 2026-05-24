import type { RouteDefinition } from './shared.js';
import { writeNotFound } from '../not-found.js';
import { writeJson } from '../response.js';
import { SessionMode } from '@/types.js';
import { RunDto, SessionDto, SessionEntryDto, SessionFeedDto } from '@/dto/index.js';
import { Run, SessionEntry } from '../../db/app/index.js';

export const sessionRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/sessions',
        handler: async ({response, queryParams, context}) => {
            const mode = queryParams.mode;

            let query = context.db
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
                .groupBy([
                    'sessions.id',
                    'sessions.mode',
                    'sessions.title',
                    'sessions.activeRunId',
                    'sessions.includePartyContext',
                    'sessions.createdAt',
                    'sessions.updatedAt',
                ]);
            if (mode != null) {
                query = query.where('mode', '=', mode as SessionMode);
            }
            const sessionRows = await query.execute();

            const sessionDtos = sessionRows.map<SessionDto>(session => ({
                ...session,
                runCount: session.runCount as number,
                includePartyContext: !!session.includePartyContext,
            }));

            writeJson(
                response,
                sessionDtos,
            );
        },
    },
    {
        method: 'GET',
        path: '/api/v2/sessions/:sessionId/feed',
        handler: async ({response, pathParams, context}) => {
            const sessionId = pathParams.sessionId;
            if (sessionId == null) {
                writeNotFound(response);
                return;
            }

            const sessionMode = await context.db
                .selectFrom('sessions')
                .select('mode')
                .where('id', '=', sessionId)
                .executeTakeFirstOrThrow();

            const runs = await context.db
                .selectFrom('runs')
                .selectAll()
                .where('sessionId', '=', sessionId)
                .execute() as Run[];

            const entries = await context.db
                .selectFrom('sessionEntries')
                .selectAll()
                .where('sessionId', '=', sessionId)
                .orderBy('sequenceIndex', 'asc')
                .execute() as SessionEntry[];

            const runDtos: RunDto[] = [];
            for (const run of runs) {
                runDtos.push({
                    ...run,
                    createdAt: run.startedAt ?? undefined,
                    failedAt: run.failedAt ?? undefined,

                    error: run.error ?? undefined,
                    sessionEntries: entries
                        .filter(e => e.runId == run.id)
                        .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
                        .map<SessionEntryDto>(e => ({
                            id: e.id,
                            sessionId: e.sessionId,
                            runId: e.runId,
                            createdAt: e.createdAt,
                            content: e.content,
                            kind: e.kind,
                            toolCallId: e.toolCallId,
                            title: e.title ?? undefined,
                        })),
                });
            }

            writeJson(response, {
                mode: sessionMode.mode,
                sessionId,
                items: runDtos,
            } satisfies SessionFeedDto);
        },
    },
];
