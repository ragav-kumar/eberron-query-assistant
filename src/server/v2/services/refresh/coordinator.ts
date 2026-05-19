import type { CreateRefreshDto, RefreshDto } from '@/dto/index.js';
import { createTaggedError, isOperationAbortedError } from '@/errors.js';
import type { AppDb, SelectRow } from '@/server/v2/db/app/index.js';
import type { RefreshOperationKind } from '@/types.js';

import { createRefreshPipeline, type RefreshPipeline, type RefreshPipelineDependencies } from './pipeline.js';
import { createRefreshStateStore, type RefreshStateStore } from './refresh-state.js';
import { assertCanStartOperation } from './state-machine.js';

export interface RefreshCoordinator {
    startRefresh(request: CreateRefreshDto): Promise<RefreshDto>;
}

interface ActiveRefreshOperation {
    abortController: AbortController;
    kind: RefreshOperationKind;
    promise: Promise<void>;
}

export interface RefreshCoordinatorDependencies {
    now?: () => Date;
    pipeline?: RefreshPipeline;
    pipelineDependencies?: RefreshPipelineDependencies;
    refreshStateStore?: RefreshStateStore;
}

export const createRefreshCoordinator = (
    appDb: AppDb,
    dependencies: RefreshCoordinatorDependencies = {},
): RefreshCoordinator => {
    const now = dependencies.now ?? (() => new Date());
    const refreshStateStore = dependencies.refreshStateStore ?? createRefreshStateStore(appDb);
    const pipeline = dependencies.pipeline ?? createRefreshPipeline(appDb, dependencies.pipelineDependencies);
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
                activeOperation = null;
            } else if (activeOperation) {
                throw createTaggedError(
                    'refresh-operation-conflict',
                    `Cannot start ${request.kind} while ${activeOperation.kind} is active.`,
                );
            }

            const pending = await refreshStateStore.setPending(request.kind, now().toISOString());
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
            });

            activeOperation = operation;

            return toRefreshDto(pending);
        },
    };
};

const runRefreshOperation = async (options: {
    activeOperationRef: () => ActiveRefreshOperation | null;
    now: () => Date;
    operation: ActiveRefreshOperation;
    pipeline: RefreshPipeline;
    refreshStateStore: RefreshStateStore;
    setActiveOperation: (nextOperation: ActiveRefreshOperation | null) => void;
}): Promise<void> => {
    try {
        await options.refreshStateStore.setRunning(options.operation.kind, options.now().toISOString());
        await options.pipeline.run(options.operation.kind, {
            abortSignal: options.operation.abortController.signal,
        });
        if (options.activeOperationRef() === options.operation) {
            await options.refreshStateStore.complete(options.operation.kind, options.now().toISOString());
        }
    } catch (error) {
        if (options.activeOperationRef() === options.operation) {
            await options.refreshStateStore.fail(options.operation.kind, options.now().toISOString());
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

const toRefreshDto = (refresh: SelectRow<'refreshState'>): RefreshDto => ({
    activeOperation: refresh.activeOperation,
    createdAt: refresh.createdAt,
    lastRefreshAt: refresh.lastRefreshAt,
    lastReingestAt: refresh.lastReingestAt,
    refreshStatus: refresh.refreshStatus,
    reingestStatus: refresh.reingestStatus,
    updatedAt: refresh.updatedAt,
});
