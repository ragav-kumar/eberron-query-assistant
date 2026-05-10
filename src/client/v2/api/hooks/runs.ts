import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import { contracts } from '@/contracts.v2.js';
import type { CreateRun } from '@/dtos.v2.js';

const queryKey = ['api', 'runs'] as const;

export const useRunsQuery = (runId: string) => useQuery({
    queryKey: [...queryKey, runId],
    queryFn: () => queryApi(contracts.runs.get, {runId}),
});

export const useRunsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (run: CreateRun) => mutateApi(contracts.runs.post, run),
        onSuccess: createdRun => queryClient.setQueryData(
            [...queryKey, createdRun.id],
            createdRun,
        ),
    });
};