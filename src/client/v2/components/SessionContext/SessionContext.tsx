import { createContext, use } from 'react';
import { TabInputState } from './tabDefinitions.js';
import { RunDto, SessionDto, SessionMode } from '@/dto/index.js';

export type SessionData = SessionDto & {
    runs: RunDto[];
};

interface SessionContextTabManagement {
    changeActiveTab: (tab: SessionMode) => void;
    activeTabState: TabInputState;
    patchActiveTabState: (state: Partial<TabInputState>) => void;
}

interface SessionContextSessionData {
    activeSessions: Record<SessionMode, SessionData | undefined>;
    sessionsByMode: (mode: SessionMode) => SessionDto[];
    changeActiveSession: (sessionId: string, mode: SessionMode) => void;
    /** Creates a UI-local temporary session for the given mode and selects it. */
    createTempSession: (mode: SessionMode) => void;
    /** Replaces the active temporary session with a real persisted session ID. */
    promoteSession: (mode: SessionMode, realSessionId: string) => void;
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
