import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/v2/api/utils.js';
import { contracts } from '@/contracts.v2.js';
import type { CreateRefresh } from '@/dtos.v2.js';

export const refreshQueryKey = ['api', 'refresh'];

export const useRefreshQuery = () => useQuery({
    queryKey: refreshQueryKey,
    queryFn: () => queryApi(contracts.refresh.get),
});

export const useRefreshMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (refreshRequest: CreateRefresh) => mutateApi(contracts.refresh.post, refreshRequest),
        onSuccess: (refresh) => queryClient.setQueryData(refreshQueryKey, refresh),
    });
};