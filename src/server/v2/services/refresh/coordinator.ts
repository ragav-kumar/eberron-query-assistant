import type { CreateRefreshDto, RefreshDto } from '@/dto/index.js';
import { createTaggedError, isOperationAbortedError } from '@/errors.js';
import type { AppDb, SelectRow } from '@server/db/app/index.js';
import type { RefreshOperationKind } from '@/types.js';

import type { ConsoleEventPublisher } from '../console-event-publisher.js';
import type { RuntimeEventPublisher } from '../runtime-event-publisher.js';
import { createRefreshPipeline, type RefreshPipeline, type RefreshPipelineDependencies } from './pipeline.js';
import { createRefreshStateStore, type RefreshStateStore } from './refresh-state.js';
import { assertCanStartOperation } from './state-machine.js';
import { createRefreshVisibility, type RefreshVisibility } from './visibility.js';

/**
 * API-facing entrypoint for the refresh feature.
 */
export interface RefreshCoordinator {
    startRefresh(request: CreateRefreshDto): Promise<RefreshDto>;
}

interface ActiveRefreshOperation {
    abortController: AbortController;
    kind: RefreshOperationKind;
    promise: Promise<void>;
}

/**
 * Optional seams for testing and app bootstrap composition.
 */
export interface RefreshCoordinatorDependencies {
    consoleEvents?: ConsoleEventPublisher;
    now?: () => Date;
    pipeline?: RefreshPipeline;
    pipelineDependencies?: RefreshPipelineDependencies;
    refreshStateStore?: RefreshStateStore;
    runtimeEvents?: RuntimeEventPublisher;
    visibility?: RefreshVisibility;
}

/**
 * Creates the singleton coordinator used by the V2 refresh route.
 *
 * The coordinator owns operation policy: it serializes runs, persists the
 * pending/running/completed/failed lifecycle, and interrupts a running refresh
 * when a force reingest is requested.
 */
export const createRefreshCoordinator = (
    appDb: AppDb,
    dependencies: RefreshCoordinatorDependencies = {},
): RefreshCoordinator => {
    const now = dependencies.now ?? (() => new Date());
    const refreshStateStore = dependencies.refreshStateStore ?? createRefreshStateStore(appDb);
    const consoleEvents = dependencies.consoleEvents ?? {
        debug: (_message: string, _timestamp?: string) => Promise.resolve({
            id: 'noop',
            level: 'debug' as const,
            message: '',
            timestamp: '',
        }),
        error: (_message: string, _timestamp?: string) => Promise.resolve({
            id: 'noop',
            level: 'error' as const,
            message: '',
            timestamp: '',
        }),
        info: (_message: string, _timestamp?: string) => Promise.resolve({
            id: 'noop',
            level: 'info' as const,
            message: '',
            timestamp: '',
        }),
        snapshot: () => Promise.resolve([]),
        subscribe: () => () => undefined,
        warn: (_message: string, _timestamp?: string) => Promise.resolve({
            id: 'noop',
            level: 'warn' as const,
            message: '',
            timestamp: '',
        }),
    };
    const runtimeEvents = dependencies.runtimeEvents ?? {
        publish: (_event) => undefined,
        publishRefreshEvent: event => ({
            ...event,
            resource: 'refresh' as const,
        }),
        subscribe: () => () => undefined,
    };
    const visibility = dependencies.visibility ?? createRefreshVisibility(
        consoleEvents,
        runtimeEvents,
    );
    const pipeline = dependencies.pipeline ?? createRefreshPipeline(appDb, {
        ...dependencies.pipelineDependencies,
        reporter: dependencies.pipelineDependencies?.reporter,
    });
    let activeOperation: ActiveRefreshOperation | null = null;

    return {
        startRefresh: async request => {
            await refreshStateStore.ensure();

            let snapshot = await refreshStateStore.read();
            if (snapshot.activeOperation && !activeOperation) {
                await refreshStateStore.fail(snapshot.activeOperation, now().toISOString());
                snapshot = await refreshStateStore.read();
            }

            assertCanStartOperation(snapshot, request.kind);
            if (activeOperation && activeOperation.kind === 'refresh' && request.kind === 'reingest') {
                activeOperation.abortController.abort();
                await activeOperation.promise.catch(() => undefined);
                await visibility.publishInterrupted(now().toISOString());
                activeOperation = null;
            } else if (activeOperation) {
                throw createTaggedError(
                    'refresh-operation-conflict',
                    `Cannot start ${request.kind} while ${activeOperation.kind} is active.`,
                );
            }

            const pendingAt = now().toISOString();
            const pending = await refreshStateStore.setPending(request.kind, pendingAt);
            await visibility.publishPending(request.kind, pendingAt);
            const abortController = new AbortController();
            const operation: ActiveRefreshOperation = {
                abortController,
                kind: request.kind,
                promise: Promise.resolve(),
            };

            operation.promise = runRefreshOperation({
                activeOperationRef: () => activeOperation,
                now,
                operation,
                pipeline,
                refreshStateStore,
                setActiveOperation: nextOperation => {
                    activeOperation = nextOperation;
                },
                visibility,
            });

            activeOperation = operation;

            return toRefreshDto(pending);
        },
    };
};

/**
 * Executes one refresh/reingest run after the coordinator has reserved the
 * active slot and recorded the initial lifecycle transition.
 */
const runRefreshOperation = async (options: {
    activeOperationRef: () => ActiveRefreshOperation | null;
    now: () => Date;
    operation: ActiveRefreshOperation;
    pipeline: RefreshPipeline;
    refreshStateStore: RefreshStateStore;
    setActiveOperation: (nextOperation: ActiveRefreshOperation | null) => void;
    visibility: RefreshVisibility;
}): Promise<void> => {
    try {
        const startedAt = options.now().toISOString();
        await options.refreshStateStore.setRunning(options.operation.kind, startedAt);
        await options.visibility.publishRunning(options.operation.kind, startedAt);
        await options.pipeline.run(options.operation.kind, {
            abortSignal: options.operation.abortController.signal,
            reporter: options.visibility.reporterFor(options.operation.kind),
        });
        if (options.activeOperationRef() === options.operation) {
            const completedAt = options.now().toISOString();
            await options.refreshStateStore.complete(options.operation.kind, completedAt);
            options.visibility.publishCompleted(options.operation.kind, completedAt);
        }
    } catch (error) {
        if (options.activeOperationRef() === options.operation) {
            const failedAt = options.now().toISOString();
            await options.refreshStateStore.fail(options.operation.kind, failedAt);
            await options.visibility.publishFailed(
                options.operation.kind,
                failedAt,
                isOperationAbortedError(error)
                    ? undefined
                    : `Refresh ${options.operation.kind} failed.`,
            );
        }

        if (!isOperationAbortedError(error)) {
            console.error(error);
        }
    } finally {
        if (options.activeOperationRef() === options.operation) {
            options.setActiveOperation(null);
        }
    }
};

/**
 * Maps the persisted singleton row into the DTO returned by the API layer.
 */
const toRefreshDto = (refresh: SelectRow<'refreshState'>): RefreshDto => ({
    activeOperation: refresh.activeOperation,
    createdAt: refresh.createdAt,
    lastRefreshAt: refresh.lastRefreshAt,
    lastReingestAt: refresh.lastReingestAt,
    refreshStatus: refresh.refreshStatus,
    reingestStatus: refresh.reingestStatus,
    updatedAt: refresh.updatedAt,
});
