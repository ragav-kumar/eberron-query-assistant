import { useQueries, useQuery } from '@tanstack/react-query';
import { queryApi } from '@/client/api/utils.js';

import { contracts } from '@/contract/index.js';

export const sessionQueryKey = ['api', 'sessions'];

export const useSessionsQuery = () => useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => queryApi(contracts.sessions.get),
});

export const useSessionFeedsQuery = (sessionIds: string[]) => useQueries({
    queries: sessionIds.map(sessionId => ({
        enabled: sessionId.trim() !== '',
        queryKey: [...sessionQueryKey, sessionId, 'feed'],
        queryFn: () => queryApi(contracts.sessions.getFeed, {sessionId}),
    })),
});