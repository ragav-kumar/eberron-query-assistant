import { useQuery } from '@tanstack/react-query';
import { queryApi } from '../utils.js';
import { endpoints } from '../endpoints.js';

export const useConsoleQuery = () => useQuery({
    queryKey: ['api', 'console'],
    queryFn: () => queryApi(endpoints.getConsole),
});