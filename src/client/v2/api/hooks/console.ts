import { useQuery } from '@tanstack/react-query';
import { contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';

export const useConsoleQuery = () => useQuery({
    queryKey: ['api', 'console'],
    queryFn: () => queryApi(contracts.console.get),
});
