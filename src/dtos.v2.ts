import type { ConsoleLevel } from './types.js';

export interface ConsoleEntryDto {
    id: string;
    level: ConsoleLevel;
    message: string;
    timestamp: string;
}

export interface LogExchangeDto {
    assistant: string;
    kind: 'exchange';
    title: string;
    user: string;
}

export interface LogProgressDto {
    kind: 'progress';
    message: string;
}

export type LogEntryDto = LogExchangeDto | LogProgressDto;

export interface LogFileDto {
    active: boolean;
    filePath: string;
    label: string;
}

export interface LogDto {
    activeFilePath: string | null;
    exchanges: LogEntryDto[];
    files: LogFileDto[];
    filePath: string | null;
    readOnly: boolean;
}

export interface NpcDto {
    age?: string;
    bio: string;
    createdAt?: string;
    description: string;
    ethnicity?: string;
    gender?: string;
    id: number;
    name: string;
    role?: string;
    species?: string;
    updatedAt?: string;
}

export interface NpcResponseDto {
    npcs: NpcDto[];
}

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

export interface ContextDto {
    markdown: string;
}

export interface RefreshDto {
    forceReingest: boolean;
}

// TODO integrate this
export interface ErrorResponseDto {
    console?: ConsoleDto;
    error?: string;
    operation?: string;
    providerDebug?: ProviderDebugEntryDto[];
}

export interface RunRequestDto {
    kind: 'assistant' | 'npc';
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
    sessionId: string;
}

// TODO integrate this
export interface RuntimeEventDto {
    inputLocked: boolean;
    activeOperation: 'refresh' | 'force-reingest' | null;
}