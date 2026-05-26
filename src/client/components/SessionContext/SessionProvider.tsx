import { SessionContext, SessionData } from './SessionContext.js';
import { ReactNode, useState } from 'react';
import { tabDefinitions, TabInputState } from './tabDefinitions.js';
import {
    SessionDto,
    SessionFeedDto,
    SessionMode,
    sessionModes,
    useRefreshQuery,
    useSessionFeedsQuery,
    useSessionsQuery,
} from '@/client/api/index.js';

/** Sentinel ID used for the UI-local temporary session before first-run promotion. */
export const TEMP_SESSION_ID = '__temp__';

export const SessionProvider = ({children}: { children: ReactNode }) => {
    const [activeTab, setActiveTab] = useState<SessionMode>('assistant');
    const [tabInputStates, setTabInputStates] = useState<Record<SessionMode, TabInputState>>(initTabInputStates);
    const [activeSessionIds, setActiveSessionIds] = useState<Record<SessionMode, string | undefined>>(initActiveSessionIds);
    const [tempSessions, setTempSessions] = useState<Record<SessionMode, SessionData | undefined>>(
        () => ({ assistant: undefined, npc: undefined }),
    );

    const sessionsQuery = useSessionsQuery();
    // Exclude the sentinel so useSessionFeedsQuery only queries real session IDs.
    const realActiveIds = Object.values(activeSessionIds).filter(
        (id): id is string => id != null && id !== TEMP_SESSION_ID,
    );
    const sessionFeedQueries = useSessionFeedsQuery(realActiveIds);
    const sessionFeedData = sessionFeedQueries
        .map(query => query.data)
        .filter((feed): feed is SessionFeedDto => feed != null);
    const refreshQuery = useRefreshQuery();
    const isBusy =
        sessionsQuery.isLoading || sessionsQuery.isPending ||
        sessionFeedQueries.some(q => q.isLoading || q.isPending) ||
        refreshQuery.data?.refreshStatus === 'running' ||
        refreshQuery.data?.reingestStatus === 'running';

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

    /**
     * Creates a UI-local temporary session for the given mode and immediately
     * selects it. The temp session lives in local state until promoteSession
     * replaces it with a real persisted session after the first run completes.
     */
    const createTempSession = (mode: SessionMode) => {
        const now = new Date().toISOString();
        const tempSession: SessionData = {
            id: TEMP_SESSION_ID,
            mode,
            title: 'Untitled',
            runCount: 0,
            createdAt: now,
            updatedAt: now,
            activeRunId: null,
            includePartyContext: null,
            runs: [],
        };
        setTempSessions(prev => ({ ...prev, [mode]: tempSession }));
        setActiveSessionIds(prev => ({ ...prev, [mode]: TEMP_SESSION_ID }));
    };

    /**
     * Swaps the active temporary session for a real persisted session ID.
     * Called after the first run against a temp session succeeds and the server
     * has created and titled the durable session.
     */
    const promoteSession = (mode: SessionMode, realSessionId: string) => {
        setTempSessions(prev => ({ ...prev, [mode]: undefined }));
        setActiveSessionIds(prev => ({ ...prev, [mode]: realSessionId }));
    };

    return (
        <SessionContext
            value={{
                changeActiveTab: setActiveTab,
                activeTabState: tabInputStates[activeTab],
                patchActiveTabState,
                activeSessions: constructActiveSessions(sessionsQuery.data, sessionFeedData, activeSessionIds, tempSessions),
                sessionsByMode: mode => sessionsQuery.data?.filter(d => d.mode === mode) ?? [],
                changeActiveSession,
                createTempSession,
                promoteSession,
                isBusy,
            }}
        >
            {children}
        </SessionContext>
    );
};

const initTabInputStates = () => {
    const stateMap: Partial<Record<SessionMode, TabInputState>> = {};
    for (const tabKey of sessionModes) {
        stateMap[tabKey] = tabDefinitions[tabKey].emptyInput;
    }
    return stateMap as Record<SessionMode, TabInputState>;
};

const initActiveSessionIds = () => ({
    assistant: undefined,
    npc: undefined,
});

const constructActiveSessions = (
    sessions: SessionDto[] | undefined,
    sessionFeed: SessionFeedDto[],
    activeSessionIds: Record<SessionMode, string | undefined>,
    tempSessions: Record<SessionMode, SessionData | undefined>,
): Record<SessionMode, SessionData | undefined> => {
    const activeSessions: Partial<Record<SessionMode, SessionData | undefined>> = {};

    for (const entry of Object.entries(activeSessionIds)) {
        const mode = entry[0] as SessionMode;
        const sessionId = entry[1];
        if (sessionId == null) {
            continue;
        }

        if (sessionId === TEMP_SESSION_ID) {
            activeSessions[mode] = tempSessions[mode];
            continue;
        }

        if (sessions == null) {
            continue;
        }

        const session = sessions.find(d => d.id === sessionId);
        const feed = sessionFeed.find(d => d.sessionId === sessionId);
        if (session == null || feed == null) {
            continue;
        }

        activeSessions[mode] = {
            ...session,
            runs: feed.items,
        };
    }

    return activeSessions as Record<SessionMode, SessionData | undefined>;
};
