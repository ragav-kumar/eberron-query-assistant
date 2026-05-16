import { SessionContext } from './SessionContext.js';
import { ReactNode, useState } from 'react';
import { TabInputState, TabKey, tabKeys } from './tabDefinitions.js';

export const SessionProvider = ({children}: { children: ReactNode }) => {
    const [activeTab, setActiveTab] = useState<TabKey>('assistant');
    const [tabInputStates, setTabInputStates] = useState<Record<TabKey, TabInputState>>(initTabInputStates);

    const patchActiveTabState = (patch: Partial<TabInputState>) => {
        setTabInputStates(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                ...patch,
            },
        }));
    };

    const submit = async () => {
        // TODO
    };

    return (
        <SessionContext
            value={{
                changeActiveTab: setActiveTab,
                activeTabState: tabInputStates[activeTab],
                patchActiveTabState,
                isBusy: false, // TODO
                submitActiveTab: submit,

            }}
        >
            {children}
        </SessionContext>
    );
};

const initTabInputStates = () => {
    const stateMap: Partial<Record<TabKey, TabInputState>> = {};
    for (const tabKey of tabKeys) {
        stateMap[tabKey] = {
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        };
    }
    return stateMap as Record<TabKey, TabInputState>;
};