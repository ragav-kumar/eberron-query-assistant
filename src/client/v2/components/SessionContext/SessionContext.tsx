import { createContext, use } from 'react';
import { TabInputState } from './tabDefinitions.js';
import { SessionFeedExchange, Session, SessionMode } from '@/dto/index.js';

export type SessionData = Session & {
    exchanges: SessionFeedExchange[];
};

interface SessionContextTabManagement {
    changeActiveTab: (tab: SessionMode) => void;
    activeTabState: TabInputState;
    patchActiveTabState: (state: Partial<TabInputState>) => void;
}

interface SessionContextSessionData {
    activeSessions: Record<SessionMode, SessionData | undefined>;
    sessionsByMode: (mode: SessionMode) => Session[];
    changeActiveSession: (sessionId: string, mode: SessionMode) => void;
}

interface SessionContextType extends SessionContextTabManagement, SessionContextSessionData {
    isBusy: boolean;
}

export const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const useSessionContext = () => {
    const context = use(SessionContext);
    if (!context) {
        throw new Error('useSessionContext must be used within a SessionContextProvider');
    }
    return context;
};