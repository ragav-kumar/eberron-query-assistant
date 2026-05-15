import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { OperationEvent } from '@/dto/index.js';
import { refreshQueryKey } from './refresh.js';
import { runQueryKey } from './runs.js';
import { sessionQueryKey } from './sessions.js';

import { contracts } from '@/contract/index.js';

export const useRuntimeSubscription = () => {
    const queryClient = useQueryClient();

    useEffect(() => {
        const events = new EventSource(contracts.events.runtime.path);

        events.onmessage = event => {
            if (typeof event.data !== 'string') {
                throw new Error('Invalid event data type.');
            }

            const operationEvent = JSON.parse(event.data) as OperationEvent;
            switch (operationEvent.resource) {
                case 'run':
                    void queryClient.invalidateQueries({queryKey: [...runQueryKey, operationEvent.resourceId]});
                    break;
                case 'refresh':
                    void queryClient.invalidateQueries({queryKey: refreshQueryKey});
                    break;
                case 'session-entry':
                    void queryClient.invalidateQueries({queryKey: sessionQueryKey});

                    if (operationEvent.sessionId == null) {
                        throw new Error('session-entry event missing sessionId');
                    }
                    void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.sessionId]});
                    void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.sessionId, 'entries']});
                    break;
                case "session":
                    break;
            }
        };

        return () => events.close();
    }, [queryClient]);
};

