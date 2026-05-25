import { useQuery } from '@tanstack/react-query';
import { NpcListQueryDto } from '@/dto/index.js';
import { queryApi } from '../utils.js';
import { contracts } from '@/contract/index.js';

export const npcQueryKey = ['api', 'npcs'] as const;

export const useNpcsQuery = (params?: NpcListQueryDto) => useQuery({
    queryKey: [...npcQueryKey, params ?? {}],
    queryFn: () => queryApi(contracts.npcs.get, params ?? {}),
});
