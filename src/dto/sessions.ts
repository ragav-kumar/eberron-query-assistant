import { SessionFeedExchange } from './sessionFeed.js';

export const sessionModes = ['assistant', 'npc'] as const;
export type SessionMode = typeof sessionModes[number];

export interface Session {
    id: string;
    mode: SessionMode;
    title: string;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
}

export interface CreateSession {
    mode: SessionMode;
    title?: string;
    includePartyContext?: boolean | null;
}

export interface SessionFeed {
    sessionId: string;
    mode: SessionMode;
    items: SessionFeedExchange[];
}