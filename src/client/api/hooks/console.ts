import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { ConsoleEntryDto } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

const queryKey = ['api', 'console'];
const EMPTY_ENTRIES: ConsoleEntryDto[] = [];

export const useConsoleEntries = () => {
    const queryClient = useQueryClient();

    return useSyncExternalStore(
        onStoreChange => queryClient.getQueryCache().subscribe(onStoreChange),
        () => queryClient.getQueryData<ConsoleEntryDto[]>(queryKey) ?? EMPTY_ENTRIES,
        () => EMPTY_ENTRIES,
    );
};

export const useConsoleSubscription = () => {
    const queryClient = useQueryClient();

    useEffect(() => {
        const events = new EventSource(contracts.events.console.path);

        events.onmessage = event => {
            if (typeof event.data !== 'string') {
                throw new Error('Invalid event data type.');
            }

            const entry = JSON.parse(event.data) as ConsoleEntryDto;
            queryClient.setQueryData<ConsoleEntryDto[]>(queryKey, prev => {
                if (prev == null) {
                    return [entry];
                }
                if (prev.some(e => e.id === entry.id)) {
                    return prev;
                }
                // Overwrite the last entry when both share a template (collapses progress-style spam).
                const last = prev[prev.length - 1];
                if (entry.template && last?.template === entry.template) {
                    return [...prev.slice(0, -1), entry];
                }
                return [...prev, entry];
            });
        };

        return () => events.close();
    }, [queryClient]);
};
