import { useQuery } from '@tanstack/react-query';
import { apiKeys } from './keys.js';
import { endpoints } from './endpoints.js';
import { queryApi } from './utils.js';

export const useAdditionalContext = () => useQuery({
    queryKey: apiKeys.context(),
    queryFn: () => queryApi(endpoints.getContext),
});

export const useLog = (sessionId: string, filePath?: string) => useQuery({
    queryKey: apiKeys.log(sessionId, filePath),
    queryFn: () => queryApi(endpoints.getLog, {sessionId, filePath}),
});

export const useNpcs = () => useQuery({
    queryKey: apiKeys.npcs(),
    queryFn: () => queryApi(endpoints.getNpcs),
});

export const useStatus = (sessionId?: string) => useQuery({
    queryKey: sessionId != null ? apiKeys.status(sessionId) : apiKeys.statusPrefix(),
    queryFn: () => queryApi(endpoints.getStatus, {sessionId}),
});
