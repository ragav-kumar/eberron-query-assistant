import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import type { CreateRun } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

export const runQueryKey = ['api', 'runs'] as const;

export const useRunsQuery = (runId: string) => useQuery({
    queryKey: [...runQueryKey, runId],
    queryFn: () => queryApi(contracts.runs.get, {runId}),
});

export const useRunsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (payload: CreateRun) => mutateApi(contracts.runs.post, payload),
        onSuccess: createdRun => queryClient.setQueryData(
            [...runQueryKey, createdRun.id],
            createdRun,
        ),
    });
};
