import type {
    AskAssistantDto,
    ContextDto,
    GenerateNpcsDto,
    LogDto,
    NpcResponseDto,
    OkDto,
    OperationResultDto,
    RefreshDto,
    StatusDto,
} from './dtos.js';

declare const endpointPayloadType: unique symbol;
declare const endpointResponseType: unique symbol;

export interface Endpoint<TPayload = unknown, TResponse = unknown> {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    queryParams: readonly string[];
    readonly [endpointPayloadType]?: TPayload;
    readonly [endpointResponseType]?: TResponse;
}

const defineEndpoint = <TPayload, TResponse>(endpoint: Endpoint<TPayload, TResponse>) => endpoint;

export const endpoints = {
    getContext: defineEndpoint<null, ContextDto>({
        method: 'GET',
        path: '/api/context',
        queryParams: [],
    }),
    putContext: defineEndpoint<ContextDto, OkDto>({
        method: 'PUT',
        path: '/api/context',
        queryParams: [],
    }),

    getLog: defineEndpoint<null, LogDto>({
        method: 'GET',
        path: '/api/log',
        queryParams: ['sessionId', 'filePath'],
    }),

    getNpcs: defineEndpoint<null, NpcResponseDto>({
        method: 'GET',
        path: '/api/npcs',
        queryParams: [],
    }),
    postNpcs: defineEndpoint<GenerateNpcsDto, OperationResultDto>({
        method: 'POST',
        path: '/api/npcs',
        queryParams: [],
    }),

    postRefresh: defineEndpoint<RefreshDto, OperationResultDto>({
        method: 'POST',
        path: '/api/refresh',
        queryParams: [],
    }),

    postAssistant: defineEndpoint<AskAssistantDto, OperationResultDto>({
        method: 'POST',
        path: '/api/assistant',
        queryParams: [],
    }),

    getStatus: defineEndpoint<null, StatusDto>({
        method: 'GET',
        path: '/api/status',
        queryParams: ['sessionId'],
    }),
} as const;
