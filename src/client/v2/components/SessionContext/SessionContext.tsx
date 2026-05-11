import { createContext, use } from 'react';
import { TabInputState, TabKey } from './tabDefinitions.js';

interface SessionContextType {
    changeActiveTab: (tab: TabKey) => void;
    activeTabState: TabInputState;
    patchActiveTabState: (state: Partial<TabInputState>) => void;

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