import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mutateApi, queryApi } from '../utils.js';
import { endpoints } from '../endpoints.js';
import type { ContextDto } from '../dtos.js';

const queryKey = ['api', 'context'];

export const useAdditionalContextQuery = () => useQuery({
    queryKey,
    queryFn: () => queryApi(endpoints.getContext, {}, 'text/markdown'),
});

export const useAdditionalContextMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (markdown: string) => mutateApi(endpoints.putContext, markdown, 'text/markdown'),
        onMutate: async markdown => {
            await queryClient.cancelQueries({queryKey});

            const previous = queryClient.getQueryData<ContextDto>(queryKey);

            queryClient.setQueryData<ContextDto>(queryKey, {markdown});

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