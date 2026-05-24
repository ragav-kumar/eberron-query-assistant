import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '@/client/api/utils.js';
import type { CreateRefreshDto } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

export const refreshQueryKey = ['api', 'refresh'];

export const useRefreshQuery = () => useQuery({
    queryKey: refreshQueryKey,
    queryFn: () => queryApi(contracts.refresh.get),
});

export const useRefreshMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (refreshRequest: CreateRefreshDto) => mutateApi(contracts.refresh.post, refreshRequest),
        onSuccess: (refresh) => queryClient.setQueryData(refreshQueryKey, refresh),
    });
};
