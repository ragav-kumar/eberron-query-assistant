import type {
    ConsoleEntry,
    CreateRefresh,
    CreateRun,
    CreateSession,
    NpcCollection,
    NpcListQuery,
    OperationEvent,
    Refresh,
    Run,
    Session,
    AssistantEntries,
    SessionSummary,
    UpdateSession,
} from '../dto/index.js';
import { defineEndpoint, defineEndpointWithQuery, defineSseEndpoint, EmptyParams } from './helpers.js';

export const contracts = {
    /**
     * Additional context is a singleton Markdown document persisted on the local
     * disk and included in later assistant work.
     */
    additionalContext: {
        /** Reads the current Markdown body of the additional-context document. */
        get: defineEndpoint<null, string>({
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'GET',
            path: '/api/v2/additional-context',
        }),
        /** Replaces the current Markdown body of the additional-context document. */
        put: defineEndpoint<string, string>({
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'PUT',
            path: '/api/v2/additional-context',
        }),
    },

    /**
     * Sessions are the primary durable conversation resource in v2.
     *
     * A session is intended to be resumable over time and owns the ordered
     * human-visible entry timeline.
     */
    sessions: {
        /** Lists session summaries for browse and selection flows. */
        getSummaries: defineEndpointWithQuery<null, SessionSummary[], EmptyParams, { mode?: string }>({
            method: 'GET',
            path: '/api/v2/sessions',
            queryParams: ['mode'],
        }),
        /** Creates a new durable conversation session. */
        post: defineEndpoint<CreateSession, Session>({
            method: 'POST',
            path: '/api/v2/sessions',
        }),
        /** Fetches server-owned metadata for one session, excluding full entry history. */
        get: defineEndpoint<null, Session, { sessionId: string }>({
            method: 'GET',
            path: '/api/v2/sessions/:sessionId',
            pathParams: ['sessionId'],
        }),
        /** Fetches the exchange feed for one session. */
        getEntries: defineEndpoint<null, AssistantEntries, { sessionId: string }>({
            method: 'GET',
            path: '/api/v2/sessions/:sessionId/entries',
            pathParams: ['sessionId'],
        }),
        /** This is the update endpoint for sessions. */
        patch: defineEndpoint<UpdateSession, Session, { sessionId: string }>({
            method: 'PATCH',
            path: '/api/v2/sessions/:sessionId',
            pathParams: ['sessionId'],
        }),
    },

    /**
     * Runs represent one execution against an existing session.
     *
     * They are created in session scope but remain independently addressable by
     * run id for follow-up fetches and event correlation.
     */
    runs: {
        /** Starts one run against the owning session. */
        post: defineEndpoint<CreateRun, Run, { sessionId: string }>({
            method: 'POST',
            path: '/api/v2/sessions/:sessionId/runs',
            pathParams: ['sessionId'],
        }),
        /** Fetches one run resource by id. */
        get: defineEndpoint<null, Run, { runId: string }>({
            method: 'GET',
            path: '/api/v2/runs/:runId',
            pathParams: ['runId'],
        }),
    },

    /**
     * NPCs are persisted generated cards, independent of the current session or
     * the run that originally created them.
     */
    npcs: {
        /** Lists the saved NPC collection. */
        get: defineEndpointWithQuery<null, NpcCollection, EmptyParams, NpcListQuery>({
            method: 'GET',
            path: '/api/v2/npcs',
            queryParams: ['skip', 'take', 'filter'],
        }),
    },

    /**
     * Refresh is conceptually an app-level singleton resource representing the
     * current ingestion / corpus-loading state for the local runtime.
     *
     * The user-facing concept is "the app's current refresh state".
     */
    refresh: {
        /**
         * Starts refresh work against the singleton refresh state and returns
         * the resulting refresh resource snapshot.
         */
        post: defineEndpoint<CreateRefresh, Refresh>({
            method: 'POST',
            path: '/api/v2/refresh',
        }),
        /**
         * Fetches the current singleton refresh state for the app.
         */
        get: defineEndpoint<null, Refresh>({
            method: 'GET',
            path: '/api/v2/refresh',
        }),
    },

    /**
     * Console is a transient diagnostic resource for process-local operational
     * output. It is intentionally not durable assistant conversation state.
     */
    console: {
        /** Reads the current in-memory console snapshot. */
        get: defineEndpoint<null, ConsoleEntry[]>({
            method: 'GET',
            path: '/api/v2/console',
        }),
    },

    /**
     * Server-sent event streams complement the fetchable resources above.
     *
     * `console` carries transient diagnostic output, while `runtime` carries
     * structured resource events such as run lifecycle changes and session-entry
     * append notifications.
     */
    events: {
        /** Streams transient console entries from the current server process. */
        console: defineSseEndpoint<ConsoleEntry>({
            path: '/api/v2/console/events',
        }),
        /** Streams structured runtime/resource events for sessions, runs, and refresh work. */
        runtime: defineSseEndpoint<OperationEvent>({
            path: '/api/v2/runtime/events',
        }),
    },
} as const;