import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contracts } from '@/contracts.v2.js';
import { queryApi } from '../utils.js';
import { useEffect } from 'react';
import type { ConsoleEntry } from '@/dtos.v2.js';

const queryKey = ['api', 'console'];

export const useConsoleQuery = () => useQuery({
    queryKey,
    queryFn: () => queryApi(contracts.console.get),
});

export const useConsoleSubscription = () => {
    const queryClient = useQueryClient();

    useEffect(() => {
        const events = new EventSource(contracts.events.console.path);

        events.onmessage = event => {
            if (typeof event.data !== 'string') {
                throw new Error('Invalid event data type.');
            }

            const entry = JSON.parse(event.data) as ConsoleEntry;
            queryClient.setQueryData<ConsoleEntry[]>(queryKey, prev => {
                if (prev == null) {
                    return [entry];
                }
                if (prev.some(e => e.id === entry.id)) {
                    return prev;
                }
                return [...prev, entry];
            });
        };

        return () => events.close();
    }, [queryClient]);
};