export interface Endpoint {
    payload: string | null;
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    queryParams: readonly string[];
    response: string;
}

export const endpoints = {
    postAssistant: {
        payload: 'AskAssistantDto',
        method: 'POST',
        path: '/api/assistant',
        queryParams: [],
        response: 'OperationResultDto',
    },
    getContext: {
        payload: null,
        method: 'GET',
        path: '/api/context',
        queryParams: [],
        response: 'ContextDto',
    },
    postNpcs: {
        payload: 'GenerateNpcsDto',
        method: 'POST',
        path: '/api/npcs',
        queryParams: [],
        response: 'OperationResultDto',
    },
    getLog: {
        payload: null,
        method: 'GET',
        path: '/api/log',
        queryParams: ['sessionId', 'filePath'],
        response: 'LogDto',
    },
    getNpcs: {
        payload: null,
        method: 'GET',
        path: '/api/npcs',
        queryParams: [],
        response: 'NpcResponseDto',
    },
    postRefresh: {
        payload: 'RefreshDto',
        method: 'POST',
        path: '/api/refresh',
        queryParams: [],
        response: 'OperationResultDto',
    },
    putContext: {
        payload: 'ContextDto',
        method: 'PUT',
        path: '/api/context',
        queryParams: [],
        response: 'OkDto',
    },
    getStatus: {
        payload: null,
        method: 'GET',
        path: '/api/status',
        queryParams: ['sessionId'],
        response: 'StatusDto',
    },
} as const satisfies Record<string, Endpoint>;
