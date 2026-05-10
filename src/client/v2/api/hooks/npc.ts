import { useQuery } from '@tanstack/react-query';
import { queryApi } from '../utils.js';
import { endpoints } from '../endpoints.js';

export const useNpcsQuery = () => useQuery({
    queryKey: ['api', 'npcs'],
    queryFn: () => queryApi(endpoints.getNpcs),
});