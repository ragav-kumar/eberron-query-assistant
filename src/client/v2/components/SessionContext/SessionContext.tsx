import { createContext, use } from 'react';
import { TabInputState, TabKey } from './tabDefinitions.js';
import { AssistantExchange, Npc, Session, SessionSummary } from '@/dto/index.js';

type SessionData = Session & ({
    mode: 'assistant',
    exchanges: AssistantExchange[];
    npcs: null;
} | {
    mode: 'npc',
    exchanges: null;
    npcs: Npc[];
});

interface SessionContextType {
    changeActiveTab: (tab: TabKey) => void;
    activeTabState: TabInputState;
    patchActiveTabState: (state: Partial<TabInputState>) => void;

    activeSession: SessionData | null;
    sessionSummaries: SessionSummary[];

    isBusy: boolean;
    submitActiveTab: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSessionContext = () => {
    const context = use(SessionContext);
    if (!context) {
        throw new Error('useSessionContext must be used within a SessionContextProvider');
    }
    return context;
};