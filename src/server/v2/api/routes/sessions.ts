import type { RouteDefinition } from './shared.js';
import { writeNotFound } from '../not-found.js';
import { writeJson } from '../response.js';
import { SessionMode } from '@/types.js';
import { Session, SessionFeed } from '@/dto/index.js';

export const sessionRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/sessions',
        handler: async ({response, queryParams, context}) => {
            const mode = queryParams.mode;

            let query = context.db
                .selectFrom('sessions')
                .leftJoin('sessionEntries', 'sessions.id', 'sessionEntries.sessionId')
                .select(({ fn }) => [
                    'sessions.id',
                    'sessions.mode',
                    'sessions.title',
                    'sessions.activeRunId',
                    'sessions.includePartyContext',
                    'sessions.createdAt',
                    'sessions.updatedAt',
                    fn.count('sessionEntries.id').as('sessionEntryCount'),
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

            const sessionDtos = sessionRows.map<Session>(session => ({
                ...session,
                sessionEntryCount: session.sessionEntryCount as number,
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

            const feed = await context.db
                .selectFrom('sessionEntries')
                .selectAll()
                .where('sessionId', '=', sessionId)
                .orderBy('sequenceIndex', 'asc')
                .execute();

            if (!feed.length) {
                writeNotFound(response);
                return;
            }

            /*
            TODO:

So for GET /sessions/:sessionId/feed, the likely construction is:

Read all runs for the session.
Read all sessionEntries for the session.
Group sessionEntries rows by runId.
For each run, build one Run:
id: run.id
status: run.status
createdAt / updatedAt: from runs
sessionEntries: grouped sessionEntries rows for that runId
            */
            /*const runDtos = feed.map<Run>(run => ({

            }));*/

            writeJson(response, {
                mode: sessionMode.mode,
                sessionId,
                items: [],// exchangeDtos,
            } satisfies SessionFeed);
        },
    },
];
