import { useQuery } from '@tanstack/react-query';
import { v2Contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';

export const useNpcsQuery = () => useQuery({
    queryKey: ['api', 'npcs'],
    queryFn: () => queryApi(v2Contracts.npcs.get),
});
