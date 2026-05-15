import type {
    ConsoleEntry,
    CreateRefresh,
    CreateRun,
    CreateSession,
    NpcCollection,
    OperationEvent,
    Refresh,
    Run,
    Session,
    SessionSummary,
} from './dtos.v2.js';

declare const endpointPayloadType: unique symbol;
declare const endpointResponseType: unique symbol;
declare const sseEventType: unique symbol;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';
export type EndpointHeaders = Readonly<Record<string, string>>;
type EmptyParams = Record<never, never>;
type PathParams = Record<string, string>;
type QueryParams = Record<string, string | undefined>;

const defaultJsonHeaders: EndpointHeaders = {
    'Content-Type': 'application/json',
};

export interface Endpoint<
    TPayload,
    TResponse,
    TPathParams extends PathParams = EmptyParams,
    TQueryParams extends QueryParams = EmptyParams,
> {
    transport: 'http';
    method: HttpMethod;
    path: string;
    pathParams: readonly (keyof TPathParams & string)[];
    queryParams: readonly (keyof TQueryParams & string)[];
    headers: EndpointHeaders;
    readonly [endpointPayloadType]?: TPayload;
    readonly [endpointResponseType]?: TResponse;
}

export interface SseEndpoint<TEvent> {
    transport: 'sse';
    method: 'GET';
    path: string;
    queryParams: readonly string[];
    readonly [sseEventType]?: TEvent;
}

const defineEndpoint = <
    TPayload,
    TResponse,
    TPathParams extends PathParams = EmptyParams,
    TQueryParams extends QueryParams = EmptyParams,
>(
    endpoint: Omit<Endpoint<TPayload, TResponse, TPathParams, TQueryParams>, 'headers' | 'pathParams' | 'queryParams' | 'transport'> & {
        headers?: EndpointHeaders;
        pathParams?: readonly (keyof TPathParams & string)[];
        queryParams?: readonly (keyof TQueryParams & string)[];
    },
): Endpoint<TPayload, TResponse, TPathParams, TQueryParams> => ({
    ...endpoint,
    headers: endpoint.headers ?? defaultJsonHeaders,
    pathParams: endpoint.pathParams ?? [],
    queryParams: endpoint.queryParams ?? [],
    transport: 'http',
});

const defineSseEndpoint = <TEvent>(
    endpoint: Omit<SseEndpoint<TEvent>, 'queryParams' | 'transport' | 'method'> & {
        queryParams?: readonly string[];
    },
): SseEndpoint<TEvent> => ({
    ...endpoint,
    method: 'GET',
    queryParams: endpoint.queryParams ?? [],
    transport: 'sse',
});

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
        getList: defineEndpoint<null, SessionSummary[]>({
            method: 'GET',
            path: '/api/v2/sessions',
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
        /** This is the update endpoint for sessions. */
        patch: defineEndpoint<Partial<Session>, Session, { sessionId: string }>({
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
        get: defineEndpoint<null, NpcCollection>({
            method: 'GET',
            path: '/api/v2/npcs',
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
