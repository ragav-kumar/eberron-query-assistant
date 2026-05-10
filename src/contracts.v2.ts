import type {
    ConsoleEntryDto,
    LogDto,
    NpcResponseDto,
    RefreshDto,
    RunRequestDto,
    RuntimeEventDto,
} from './dtos.v2.js';

declare const endpointPayloadType: unique symbol;
declare const endpointResponseType: unique symbol;
declare const sseEventType: unique symbol;

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface Endpoint<TPayload, TResponse> {
    transport: 'http';
    method: HttpMethod;
    path: string;
    queryParams: readonly string[];
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
    endpoint: Omit<Endpoint<TPayload, TResponse>, 'queryParams' | 'transport'> & {
        queryParams?: readonly string[];
    },
): Endpoint<TPayload, TResponse> => ({
    ...endpoint,
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

export const v2Contracts = {
    // Additional context
    getContext: defineEndpoint<null, string>({
        method: 'GET',
        path: '/api/v2/context',
    }),
    putContext: defineEndpoint<string, string>({
        method: 'PUT',
        path: '/api/v2/context',
    }),

    // Log files
    getLog: defineEndpoint<null, LogDto>({
        method: 'GET',
        path: '/api/v2/logs',
        queryParams: ['sessionId', 'filePath'],
    }),

    // NPC cards
    getNpcs: defineEndpoint<null, NpcResponseDto>({
        method: 'GET',
        path: '/api/v2/npcs',
    }),

    // Refresh
    postRefresh: defineEndpoint<RefreshDto, null>({
        method: 'POST',
        path: '/api/v2/refresh',
    }),

    // Run management
    postRun: defineEndpoint<RunRequestDto, null>({
        method: 'POST',
        path: '/api/v2/runs',
    }),

    // Console (initial fetch)
    getConsole: defineEndpoint<null, ConsoleEntryDto[]>({
        method: 'GET',
        path: '/api/v2/console',
    }),

    // Server-sent events
    consoleEvents: defineSseEndpoint<ConsoleEntryDto>({
        path: '/api/v2/console/events',
    }),
    runtimeEvents: defineSseEndpoint<RuntimeEventDto>({
        path: '/api/v2/runtime/events',
    }),
} as const;

export type V2ContractMap = typeof v2Contracts;
