import type {
    CreateRunDto,
    LogDto,
    NpcResponseDto,
    RefreshDto,
    RunDto,
} from './dtos.js';

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
        path: '/api/context',
    }),
    putContext: defineEndpoint<string, string>({
        method: 'PUT',
        path: '/api/context',
    }),

    // Log files
    getLog: defineEndpoint<null, LogDto>({
        method: 'GET',
        path: '/api/logs',
        queryParams: ['sessionId', 'filePath'],
    }),

    // NPC cards
    getNpcs: defineEndpoint<null, NpcResponseDto>({
        method: 'GET',
        path: '/api/npcs',
    }),

    // Refresh
    postRefresh: defineEndpoint<RefreshDto, null>({
        method: 'POST',
        path: '/api/refresh',
    }),

    // Run management
    postRun: defineEndpoint<CreateRunDto, RunDto>({
        method: 'POST',
        path: '/api/runs',
    }),
    getRun: defineEndpoint<null, RunDto>({
        method: 'GET',
        path: '/api/runs/:runId',
    }),
} as const;

 // Also have to define SSE contracts for runtime state and console entries