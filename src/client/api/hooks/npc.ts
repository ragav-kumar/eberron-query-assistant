import { useQuery } from '@tanstack/react-query';
import { queryApi } from '../utils.js';

import { contracts } from '@/contract/index.js';

export const useNpcsQuery = () => useQuery({
    queryKey: ['api', 'npcs'],
    queryFn: () => queryApi(contracts.npcs.get),
});
