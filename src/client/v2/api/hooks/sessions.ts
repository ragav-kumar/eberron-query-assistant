import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import type { CreateSession } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

export const sessionQueryKey = ['api', 'sessions'];

export const useSessionsQuery = () => useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => queryApi(contracts.sessions.getSummaries),
});

export const useSessionQuery = (sessionId: string) => useQuery({
    queryKey: [...sessionQueryKey, sessionId],
    queryFn: () => queryApi(contracts.sessions.get, {sessionId}),
});

export const useSessionMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (session: CreateSession) => mutateApi(contracts.sessions.post, session),
        onSuccess: createdSession => queryClient.setQueryData([...sessionQueryKey, createdSession.id], createdSession),
        onSettled: () => {
            void queryClient.invalidateQueries({queryKey: sessionQueryKey});
        },
    });
};
