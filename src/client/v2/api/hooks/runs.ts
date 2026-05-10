import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import { contracts } from '@/contracts.v2.js';
import type { CreateRun } from '@/dtos.v2.js';

interface CreateRunRequest {
    sessionId: string;
    payload: CreateRun;
}

export const runQueryKey = ['api', 'runs'] as const;

export const useRunsQuery = (runId: string) => useQuery({
    queryKey: [...runQueryKey, runId],
    queryFn: () => queryApi(contracts.runs.get, {runId}),
});

export const useRunsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({sessionId, payload}: CreateRunRequest) => mutateApi(contracts.runs.post, payload, {sessionId}),
        onSuccess: createdRun => queryClient.setQueryData(
            [...runQueryKey, createdRun.id],
            createdRun,
        ),
    });
};