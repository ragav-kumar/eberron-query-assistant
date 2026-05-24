import type { OperationEventDto, RefreshOperationEventDto } from '@/dto/index.js';
import type { RefreshOperationKind, RefreshStatus } from '@/types.js';

type RuntimeEventSubscriber = (event: OperationEventDto) => void;

export interface RuntimeEventPublisher {
    publish(event: OperationEventDto): void;
    publishRefreshEvent(event: Omit<RefreshOperationEventDto, 'resource'>): RefreshOperationEventDto;
    subscribe(listener: RuntimeEventSubscriber): () => void;
}

export const createRuntimeEventPublisher = (): RuntimeEventPublisher => {
    const subscribers = new Set<RuntimeEventSubscriber>();

    const publish = (event: OperationEventDto): void => {
        for (const subscriber of subscribers) {
            subscriber(event);
        }
    };

    return {
        publish,
        publishRefreshEvent: event => {
            const refreshEvent: RefreshOperationEventDto = {
                ...event,
                resource: 'refresh',
            };

            publish(refreshEvent);
            return refreshEvent;
        },
        subscribe: listener => {
            subscribers.add(listener);
            return () => {
                subscribers.delete(listener);
            };
        },
    };
};

export const createRefreshOperationEvent = (options: {
    action: RefreshOperationEventDto['action'];
    kind: RefreshOperationKind;
    status: RefreshStatus;
    timestamp: string;
}): Omit<RefreshOperationEventDto, 'resource'> => ({
    action: options.action,
    kind: options.kind,
    resourceId: 'refresh',
    status: options.status,
    timestamp: options.timestamp,
});
