import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { OperationEventDto } from '@/dto/index.js';
import { npcQueryKey } from './npc.js';
import { refreshQueryKey } from './refresh.js';
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

            const operationEvent = JSON.parse(event.data) as OperationEventDto;
            switch (operationEvent.resource) {
                case 'run':
                    void queryClient.invalidateQueries({queryKey: sessionQueryKey});
                    void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.sessionId, 'feed']});
                    void queryClient.invalidateQueries({queryKey: npcQueryKey});
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
                    void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.sessionId, 'feed']});
                    break;
                case 'session':
                    void queryClient.invalidateQueries({queryKey: sessionQueryKey});
                    void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.sessionId, 'feed']});
                    if (operationEvent.replacedSessionId != null) {
                        void queryClient.invalidateQueries({queryKey: [...sessionQueryKey, operationEvent.replacedSessionId, 'feed']});
                    }
                    break;
            }
        };

        return () => events.close();
    }, [queryClient]);
};

