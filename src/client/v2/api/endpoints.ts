import type {
    ConsoleEntryDto,
    RunRequestDto,
    LogDto,
    NpcResponseDto,
    RefreshDto,
    RunDto,
} from './index.js';

declare const endpointPayloadType: unique symbol;
declare const endpointResponseType: unique symbol;

export interface Endpoint<TPayload, TResponse> {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    queryParams: readonly string[];
    readonly [endpointPayloadType]?: TPayload;
    readonly [endpointResponseType]?: TResponse;
}

const defineEndpoint = <TPayload, TResponse>(
    endpoint: Omit<Endpoint<TPayload, TResponse>, 'queryParams'> & { queryParams?: string[] },
) => ({
    ...endpoint,
    queryParams: endpoint.queryParams ?? [],
});

export const endpoints = {
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
} as const;

 // Also have to define SSE contracts for runtime state and console entries
// console events SSE: /api/v2/console/events