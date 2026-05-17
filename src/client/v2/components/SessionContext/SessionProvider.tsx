import { SessionContext, SessionData } from './SessionContext.js';
import { ReactNode, useState } from 'react';
import { TabInputState, TabKey, tabKeys } from './tabDefinitions.js';
import { Session, SessionFeed, SessionMode, useSessionFeedsQuery, useSessionsQuery } from '@/client/v2/api/index.js';

export const SessionProvider = ({children}: { children: ReactNode }) => {
    const [activeTab, setActiveTab] = useState<TabKey>('assistant');
    const [tabInputStates, setTabInputStates] = useState<Record<TabKey, TabInputState>>(initTabInputStates);
    const [activeSessionIds, setActiveSessionIds] = useState<Record<SessionMode, string | undefined>>(initActiveSessionIds);

    const sessionsQuery = useSessionsQuery();
    const sessionFeedQueries = useSessionFeedsQuery(
        Object.values(activeSessionIds).filter(Boolean) as string[],
    );
    const sessionFeedData = sessionFeedQueries
        .map(query => query.data)
        .filter((feed): feed is SessionFeed => feed != null);
    const isBusy =
        sessionsQuery.isLoading || sessionsQuery.isPending ||
        sessionFeedQueries.some(q => q.isLoading || q.isPending);

    const patchActiveTabState = (patch: Partial<TabInputState>) => {
        setTabInputStates(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                ...patch,
            },
        }));
    };

    const changeActiveSession = (sessionId: string, mode: SessionMode) => {
        setActiveSessionIds(prev => ({
            ...prev,
            [mode]: sessionId,
        }));
    };
    return (
        <SessionContext
            value={{
                changeActiveTab: setActiveTab,
                activeTabState: tabInputStates[activeTab],
                patchActiveTabState,
                activeSessions: constructActiveSessions(sessionsQuery.data, sessionFeedData, activeSessionIds),
                sessionsByMode: mode => sessionsQuery.data?.filter(d => d.mode === mode) ?? [],
                changeActiveSession,
                isBusy,
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

const initActiveSessionIds = () => ({
    assistant: undefined,
    npc: undefined,
});

const constructActiveSessions = (
    sessions: Session[] | undefined,
    sessionFeed: SessionFeed[],
    activeSessionIds: Record<SessionMode, string | undefined>,
): Record<SessionMode, SessionData | undefined> => {
    const activeSessions: Partial<Record<SessionMode, SessionData | undefined>> = {};

    for (const entry of Object.entries(activeSessionIds)) {
        const mode = entry[0] as SessionMode;
        const sessionId = entry[1];
        if (sessionId == null || sessions == null) {
            continue;
        }

        const session = sessions.find(d => d.id === sessionId);
        const feed = sessionFeed.find(d => d.sessionId === sessionId);
        if (session == null || feed == null) {
            continue;
        }

        activeSessions[mode] = {
            ...session,
            exchanges: feed.items,
        };
    }

    return activeSessions as Record<SessionMode, SessionData | undefined>;
};
