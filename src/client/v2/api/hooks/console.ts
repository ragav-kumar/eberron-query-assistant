import { useQuery } from '@tanstack/react-query';
import { v2Contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';

export const useConsoleQuery = () => useQuery({
    queryKey: ['api', 'console'],
    queryFn: () => queryApi(v2Contracts.getConsole),
});
