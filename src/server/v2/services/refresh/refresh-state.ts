import type { RefreshOperationKind } from '@/types.js';
import type { AppDb } from '@/server/v2/db/app/db.js';
import type { RefreshState, SelectRow } from '@/server/v2/db/app/schema.js';

const SINGLETON_KEY = 1;

export interface RefreshStateStore {
    complete(kind: RefreshOperationKind, now: string): Promise<SelectRow<'refreshState'>>;
    ensure(): Promise<void>;
    fail(kind: RefreshOperationKind, now: string): Promise<SelectRow<'refreshState'>>;
    read(): Promise<SelectRow<'refreshState'>>;
    setPending(kind: RefreshOperationKind, now: string): Promise<SelectRow<'refreshState'>>;
    setRunning(kind: RefreshOperationKind, now: string): Promise<SelectRow<'refreshState'>>;
}

export const createRefreshStateStore = (appDb: AppDb): RefreshStateStore => ({
    ensure: async () => {
        const now = new Date().toISOString();

        await appDb.db
            .insertInto('refreshState')
            .values({
                singletonKey: SINGLETON_KEY,
                activeOperation: null,
                refreshStatus: 'failed',
                reingestStatus: 'failed',
                lastRefreshAt: null,
                lastReingestAt: null,
                createdAt: now,
                updatedAt: now,
            })
            .onConflict(conflict => conflict.column('singletonKey').doNothing())
            .execute();
    },

    read: async () => appDb.db
        .selectFrom('refreshState')
        .selectAll()
        .where('singletonKey', '=', SINGLETON_KEY)
        .executeTakeFirstOrThrow(),

    setPending: async (kind, now) => {
        await updateRefreshState(appDb, {
            activeOperation: kind,
            updatedAt: now,
            [statusColumn(kind)]: 'pending',
        });

        return appDb.db
            .selectFrom('refreshState')
            .selectAll()
            .where('singletonKey', '=', SINGLETON_KEY)
            .executeTakeFirstOrThrow();
    },

    setRunning: async (kind, now) => {
        await updateRefreshState(appDb, {
            activeOperation: kind,
            updatedAt: now,
            [statusColumn(kind)]: 'running',
        });

        return appDb.db
            .selectFrom('refreshState')
            .selectAll()
            .where('singletonKey', '=', SINGLETON_KEY)
            .executeTakeFirstOrThrow();
    },

    complete: async (kind, now) => {
        await updateRefreshState(appDb, {
            activeOperation: null,
            updatedAt: now,
            [statusColumn(kind)]: 'completed',
            [completedAtColumn(kind)]: now,
        });

        return appDb.db
            .selectFrom('refreshState')
            .selectAll()
            .where('singletonKey', '=', SINGLETON_KEY)
            .executeTakeFirstOrThrow();
    },

    fail: async (kind, now) => {
        await updateRefreshState(appDb, {
            activeOperation: null,
            updatedAt: now,
            [statusColumn(kind)]: 'failed',
        });

        return appDb.db
            .selectFrom('refreshState')
            .selectAll()
            .where('singletonKey', '=', SINGLETON_KEY)
            .executeTakeFirstOrThrow();
    },
});

const completedAtColumn = (kind: RefreshOperationKind): 'lastRefreshAt' | 'lastReingestAt' => (
    kind === 'refresh' ? 'lastRefreshAt' : 'lastReingestAt'
);

const statusColumn = (kind: RefreshOperationKind): 'refreshStatus' | 'reingestStatus' => (
    kind === 'refresh' ? 'refreshStatus' : 'reingestStatus'
);

const updateRefreshState = async (
    appDb: AppDb,
    changes: Partial<RefreshState>,
): Promise<void> => {
    await appDb.db
        .updateTable('refreshState')
        .set(changes)
        .where('singletonKey', '=', SINGLETON_KEY)
        .execute();
};
