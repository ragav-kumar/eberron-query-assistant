import { RunStatus, SessionMode } from '@/types.js';

export interface SessionEntryDtoBase {
    id: string;
    kind: 'user' | 'reasoning' | 'response';
    sessionId: string;
    runId: string;
    createdAt: string;
    content: string;
}

export interface SessionEntryUserDto extends SessionEntryDtoBase {
    kind: 'user';
}

export interface SessionEntryReasoningDto extends SessionEntryDtoBase {
    kind: 'reasoning';
    toolCallId: string | null;
}

export interface SessionEntryResponseDto extends SessionEntryDtoBase {
    kind: 'response';
    title?: string;
}

export type SessionEntryDto =
    | SessionEntryUserDto
    | SessionEntryReasoningDto
    | SessionEntryResponseDto;

export interface RunDto {
    id: string;
    sessionId: string;
    mode: SessionMode;
    status: RunStatus;
    createdAt?: string;
    updatedAt: string;
    sessionEntries: SessionEntryDto[];
    failedAt?: string;
    error?: string;
}

export interface CreateRunDto {
    // If not set, create a temporary session in memory
    sessionId?: string | undefined | null;
    mode: SessionMode;
    includePartyContext: boolean;
    prompt: string;
    retrievalTurnLimit: number;
}
