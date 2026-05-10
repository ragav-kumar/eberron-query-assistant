import { useQuery } from '@tanstack/react-query';
import { v2Contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';

export const useLogQuery = (sessionId: string, filePath?: string) => useQuery({
    queryKey: ['api', 'log', sessionId, filePath ?? null],
    queryFn: () => queryApi(v2Contracts.getLog, {sessionId, filePath}),
});
