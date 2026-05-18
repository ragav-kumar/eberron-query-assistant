import { loadDefaultConfig } from '@/server/v1/config/index.js';

import { AppDb, createAppDb } from './db/index.js';

/**
 * V2 routes should depend on an app-level context rather than on the raw DB handle.
 *
 * Today this only wraps the database lifecycle, but V2 will also need to carry
 * process-local runtime services that do not belong in SQLite itself, such as
 * transient console/event publishers, refresh coordination, and other
 * long-lived server-side orchestration state.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- will be expanded later
export interface V2AppContext extends AppDb {
}

// noinspection JSUnusedGlobalSymbols
export const createV2App = async (): Promise<V2AppContext> => {
    const config = loadDefaultConfig();
    const appDb = await createAppDb(config);

    return {
        close: appDb.close,
        db: appDb.db,
    };
};
