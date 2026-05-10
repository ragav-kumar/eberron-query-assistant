import type {
    ConsoleEntry,
    ConsoleSnapshot,
    CreateRefresh,
    CreateRun,
    CreateSession,
    NpcCollection,
    OperationEvent,
    Refresh,
    Run,
    Session,
    SessionEntry,
    SessionSummary,
} from './dtos.v2.js';

declare const endpointPayloadType: unique symbol;
declare const endpointResponseType: unique symbol;
declare const sseEventType: unique symbol;

export type HttpMethod = 'GET' | 'POST' | 'PUT';
export type EndpointHeaders = Readonly<Record<string, string>>;

const defaultJsonHeaders: EndpointHeaders = {
    'Content-Type': 'application/json',
};

export interface Endpoint<TPayload, TResponse> {
    transport: 'http';
    method: HttpMethod;
    path: string;
    pathParams: readonly string[];
    queryParams: readonly string[];
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

const defineEndpoint = <TPayload, TResponse>(
    endpoint: Omit<Endpoint<TPayload, TResponse>, 'headers' | 'pathParams' | 'queryParams' | 'transport'> & {
        headers?: EndpointHeaders;
        pathParams?: readonly string[];
        queryParams?: readonly string[];
    },
): Endpoint<TPayload, TResponse> => ({
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
    additionalContext: {
        get: defineEndpoint<null, string>({
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'GET',
            path: '/api/v2/additional-context',
        }),
        put: defineEndpoint<string, string>({
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'PUT',
            path: '/api/v2/additional-context',
        }),
    },

    sessions: {
        get: defineEndpoint<null, SessionSummary[]>({
            method: 'GET',
            path: '/api/v2/sessions',
        }),
        post: defineEndpoint<CreateSession, Session>({
            method: 'POST',
            path: '/api/v2/sessions',
        }),
        getOne: defineEndpoint<null, Session>({
            method: 'GET',
            path: '/api/v2/sessions/:sessionId',
            pathParams: ['sessionId'],
        }),
        getEntries: defineEndpoint<null, SessionEntry[]>({
            method: 'GET',
            path: '/api/v2/sessions/:sessionId/entries',
            pathParams: ['sessionId'],
        }),
    },

    runs: {
        post: defineEndpoint<CreateRun, Run>({
            method: 'POST',
            path: '/api/v2/sessions/:sessionId/runs',
            pathParams: ['sessionId'],
        }),
        get: defineEndpoint<null, Run>({
            method: 'GET',
            path: '/api/v2/runs/:runId',
            pathParams: ['runId'],
        }),
    },

    npcs: {
        get: defineEndpoint<null, NpcCollection>({
            method: 'GET',
            path: '/api/v2/npcs',
        }),
    },

    refresh: {
        post: defineEndpoint<CreateRefresh, Refresh>({
            method: 'POST',
            path: '/api/v2/refresh',
        }),
        get: defineEndpoint<null, Refresh>({
            method: 'GET',
            path: '/api/v2/refresh/:refreshId',
            pathParams: ['refreshId'],
        }),
    },

    console: {
        get: defineEndpoint<null, ConsoleSnapshot>({
            method: 'GET',
            path: '/api/v2/console',
        }),
    },

    // Server-sent events
    events: {
        console: defineSseEndpoint<ConsoleEntry>({
            path: '/api/v2/console/events',
        }),
        runtime: defineSseEndpoint<OperationEvent>({
            path: '/api/v2/runtime/events',
        }),
    },
} as const;

export type ContractMap = typeof contracts;
