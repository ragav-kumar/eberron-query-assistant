import type {
    ConsoleEntry,
    CreateRefresh,
    CreateRun,
    NpcCollection,
    NpcListQuery,
    OperationEvent,
    Refresh,
    Run,
    Session,
    SessionFeed,
    SessionMode,
} from '@/dto/index.js';
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
        /** Lists sessions. */
        get: defineEndpointWithQuery<null, Session[], EmptyParams, { mode?: SessionMode }>({
            method: 'GET',
            path: '/api/v2/sessions',
            queryParams: ['mode'],
        }),
        /** Fetches the exchange feed for one session. */
        getFeed: defineEndpoint<null, SessionFeed, { sessionId: string }>({
            method: 'GET',
            path: '/api/v2/sessions/:sessionId/feed',
            pathParams: ['sessionId'],
        }),
    },

    /**
     * Runs represent one execution against an existing session, or trigger creating a new session.
     */
    runs: {
        /** Starts a run against a session, ore create a new session. */
        post: defineEndpoint<CreateRun, Run>({
            method: 'POST',
            path: '/api/v2/runs',
        }),
    },

    /**
     * NPCs are persisted generated cards, independent of the current session or
     * the run that originally created them.
     *
     * This needs to be its own resource because we list npcs in a session-independent way
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
            path: '/api/v2/events/console',
        }),
        /** Streams structured runtime/resource events for sessions, runs, and refresh work. */
        runtime: defineSseEndpoint<OperationEvent>({
            path: '/api/v2/events/runtime',
        }),
    },
} as const;
