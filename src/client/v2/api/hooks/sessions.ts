import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import { CreateSession } from '@/dto/index.js';

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

export const useCreateSessionMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (session: CreateSession) => mutateApi(contracts.sessions.post, session),
        onSuccess: createdSession => queryClient.setQueryData([...sessionQueryKey, createdSession.id], createdSession),
        onSettled: () => {
            void queryClient.invalidateQueries({queryKey: sessionQueryKey});
        },
    });
};