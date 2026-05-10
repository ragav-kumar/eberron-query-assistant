import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import { contracts } from '@/contracts.v2.js';
import type { CreateSession } from '@/dtos.v2.js';

export const sessionQueryKey = ['api', 'sessions'];

export const useSessionsQuery = () => useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => queryApi(contracts.sessions.get),
});

export const useSessionQuery = (sessionId: string) => useQuery({
    queryKey: [...sessionQueryKey, sessionId],
    queryFn: () => queryApi(contracts.sessions.getOne, {sessionId}),
});

export const useSessionEntriesQuery = (sessionId: string) => useQuery({
    queryKey: [...sessionQueryKey, sessionId, 'entries'],
    queryFn: () => queryApi(contracts.sessions.getEntries, {sessionId}),
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