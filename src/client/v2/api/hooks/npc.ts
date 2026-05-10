import { useQuery } from '@tanstack/react-query';
import { contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';

export const useNpcsQuery = () => useQuery({
    queryKey: ['api', 'npcs'],
    queryFn: () => queryApi(contracts.npcs.get),
});
