import { useQuery } from '@tanstack/react-query';
import { queryApi } from '../utils.js';
import { endpoints } from '../endpoints.js';

export const useLogQuery = (sessionId: string, filePath?: string) => useQuery({
    queryKey: ['api', 'log', sessionId, filePath ?? null],
    queryFn: () => queryApi(endpoints.getLog, {sessionId, filePath}),
});