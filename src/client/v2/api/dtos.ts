export type ConsoleLevelDto = 'debug' | 'error' | 'info' | 'warn';

export interface ConsoleEntryDto {
    id: string;
    level: ConsoleLevelDto;
    message: string;
    timestamp: string;
}

export interface ConsoleDto {
    entries: ConsoleEntryDto[];
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

export interface SourceInventoryResultDto {
    added: number;
    details: string[];
    discovered: number;
    failed: number;
    message: string;
    removed: number;
    sourceType: 'article' | 'foundry' | 'pdf';
    status: 'failed' | 'missing' | 'scheduled' | 'skipped';
    updated: number;
}

export interface RefreshSummaryDto {
    degraded: boolean;
    degradedSources: ('article' | 'foundry' | 'pdf')[];
    forceReingest: boolean;
    inventories: SourceInventoryResultDto[];
    retrieval?: {
        chunkCount: number;
        regeneratedEmbeddings: number;
        reusedEmbeddings: number;
    };
}

export interface OperationResultDto {
    console: ConsoleDto;
    log: LogDto;
    npcs: NpcResponseDto;
    ok: true;
    providerDebug?: ProviderDebugEntryDto[];
    summary?: RefreshSummaryDto;
}

export interface StatusDto {
    activeOperation: string | null;
    console: ConsoleDto;
    log: LogDto;
    npcs: NpcResponseDto;
}

export interface ContextDto {
    markdown: string;
}

export interface OkDto {
    ok: true;
}

export interface StatusQueryDto {
    sessionId: string;
}

export interface LogQueryDto {
    filePath?: string;
    sessionId: string;
}

export interface AskAssistantDto {
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
    sessionId: string;
}

export interface RefreshDto {
    forceReingest: boolean;
}

export interface ErrorResponseDto {
    console?: ConsoleDto;
    error?: string;
    operation?: string;
    providerDebug?: ProviderDebugEntryDto[];
}

export interface CreateRunDto {
    kind: 'assistant' | 'npc';
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
    sessionId: string;
}

export interface RunDto {
    id: string;
    kind: 'assistant' | 'npc';
    status: string; // For now
    startedAt: Date;
    // TODO: Add other fields as needed?
}

export interface RuntimeEventDto {
    inputLocked: boolean;
    activeOperation: 'refresh' | 'force-reingest' | null;
}