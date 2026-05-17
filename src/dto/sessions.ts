import type { SessionMode } from '@/types.js';
import { SessionFeedExchange } from './sessionFeed.js';

export interface Session {
    id: string;
    mode: SessionMode;
    title: string;
    exchangeCount: number;
    createdAt: string;
    updatedAt: string;
    activeRunId: string | null;
    includePartyContext: boolean | null;
}

export interface SessionFeed {
    sessionId: string;
    mode: SessionMode;
    items: SessionFeedExchange[];
}
