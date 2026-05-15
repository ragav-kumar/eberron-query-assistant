import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '../utils.js';

import { contracts } from '@/contract/index.js';

const queryKey = ['api', 'context'];

export const useAdditionalContextQuery = () => useQuery({
    queryKey,
    queryFn: () => queryApi(contracts.additionalContext.get),
});

export const useAdditionalContextMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (markdown: string) => mutateApi(contracts.additionalContext.put, markdown),
        onMutate: async markdown => {
            await queryClient.cancelQueries({queryKey});
            const previous = queryClient.getQueryData<string>(queryKey);
            queryClient.setQueryData<string>(queryKey, markdown);
            return {previous};
        },
        onError: (_error, _markdown, mutateResult) => {
            if (mutateResult?.previous) {
                queryClient.setQueryData(queryKey, mutateResult.previous);
            }
        },
        onSettled: () => {
            void queryClient.invalidateQueries({queryKey});
        },
    });
};
