import type { ProgressReporter } from '@/server/v2/db/corpus/index.js';
import type { RefreshOperationKind } from '@/types.js';

import type { ConsoleEventPublisher } from '../console-event-publisher.js';
import { createRefreshOperationEvent, type RuntimeEventPublisher } from '../runtime-event-publisher.js';

export interface RefreshVisibility {
    publishCompleted(kind: RefreshOperationKind, timestamp: string): void;
    publishFailed(kind: RefreshOperationKind, timestamp: string, message?: string): Promise<void>;
    publishInterrupted(timestamp: string): Promise<void>;
    publishRecoveredAfterShutdown(interruptedKind: RefreshOperationKind, restartingKind: RefreshOperationKind, timestamp: string): Promise<void>;
    publishPending(kind: RefreshOperationKind, timestamp: string): Promise<void>;
    publishRunning(kind: RefreshOperationKind, timestamp: string): Promise<void>;
    reporterFor(kind: RefreshOperationKind): ProgressReporter;
}

export const createRefreshVisibility = (
    consoleEvents: ConsoleEventPublisher,
    runtimeEvents: RuntimeEventPublisher,
): RefreshVisibility => {
    const publishRunningUpdate = (kind: RefreshOperationKind, timestamp: string): void => {
        runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
            action: 'updated',
            kind,
            status: 'running',
            timestamp,
        }));
    };

    return {
        publishCompleted: (kind, timestamp) => {
            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'completed',
                kind,
                status: 'completed',
                timestamp,
            }));
        },
        publishFailed: async (kind, timestamp, message) => {
            if (message) {
                await consoleEvents.error(message, timestamp);
            }

            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'failed',
                kind,
                status: 'failed',
                timestamp,
            }));
        },
        publishInterrupted: async timestamp => {
            await consoleEvents.warn('Force reingest interrupted the active refresh.', timestamp);
            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'updated',
                kind: 'refresh',
                status: 'failed',
                timestamp,
            }));
        },
        publishRecoveredAfterShutdown: async (interruptedKind, restartingKind, timestamp) => {
            await consoleEvents.warn(
                interruptedKind === 'refresh'
                    ? 'Previous refresh was interrupted by shutdown. Restarting refresh.'
                    : restartingKind === 'reingest'
                        ? 'Previous force reingest was interrupted by shutdown. Restarting force reingest.'
                        : 'Previous force reingest was interrupted by shutdown.',
                timestamp,
            );
            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'failed',
                kind: interruptedKind,
                status: 'failed',
                timestamp,
            }));
        },
        publishPending: async (kind, timestamp) => {
            await consoleEvents.info(
                kind === 'refresh'
                    ? 'Refresh requested.'
                    : 'Force reingest requested.',
                timestamp,
            );
            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'created',
                kind,
                status: 'pending',
                timestamp,
            }));
        },
        publishRunning: async (kind, timestamp) => {
            await consoleEvents.info(
                kind === 'refresh'
                    ? 'Refresh started.'
                    : 'Force reingest started.',
                timestamp,
            );
            runtimeEvents.publishRefreshEvent(createRefreshOperationEvent({
                action: 'updated',
                kind,
                status: 'running',
                timestamp,
            }));
        },
        reporterFor: kind => ({
            info: message => {
                const timestamp = new Date().toISOString();
                void consoleEvents.info(message, timestamp);
                publishRunningUpdate(kind, timestamp);
            },
            progress: message => {
                const timestamp = new Date().toISOString();
                void consoleEvents.info(message, timestamp);
                publishRunningUpdate(kind, timestamp);
            },
            warn: message => {
                const timestamp = new Date().toISOString();
                void consoleEvents.warn(message, timestamp);
                publishRunningUpdate(kind, timestamp);
            },
        }),
    };
};
