import type { ConsoleEntryDto } from './console.js';

export interface ProviderDebugEntryDto {
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

export interface ApiErrorDto {
    console?: ConsoleEntryDto[];
    error?: string;
    operation?: string;
    providerDebug?: ProviderDebugEntryDto[];
}
