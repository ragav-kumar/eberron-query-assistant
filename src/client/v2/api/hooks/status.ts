import { useQuery } from '@tanstack/react-query';
import { queryApi } from '../utils.js';
import { endpoints } from '../endpoints.js';

export const useStatusQuery = (sessionId?: string) => useQuery({
    queryKey: ['api', 'status', sessionId],
    queryFn: () => queryApi(endpoints.getStatus, {sessionId}),
});