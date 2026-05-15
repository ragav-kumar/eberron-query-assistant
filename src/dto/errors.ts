import type { ConsoleEntry } from './console.js';

export interface ProviderDebugEntry {
    assistantContent?: string;
    endpoint: string;
    error?: string;
    ok: boolean;
    operation: string;
    operationId: string;
    purpose: string;
    requestBody: {
        messages: unknown[];
        model: string;
        tools?: unknown[];
    };
    responseBody?: unknown;
    status?: number;
    timestamp: string;
}

export interface ApiError {
    console?: ConsoleEntry[];
    error?: string;
    operation?: string;
    providerDebug?: ProviderDebugEntry[];
}
