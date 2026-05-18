import { loadDefaultConfig } from '@/server/v1/config/index.js';
import type { RuntimeConfig } from '@/types.js';

import { createAppDb } from './db/index.js';

export interface V2AppDependencies {
    config?: RuntimeConfig;
}

// noinspection JSUnusedGlobalSymbols
export const initializeV2App = async (dependencies: V2AppDependencies = {}): Promise<void> => {
    const config = dependencies.config ?? loadDefaultConfig();
    const appDb = await createAppDb(config);

    try {
        void appDb.db;
    } finally {
        await appDb.close();
    }
};
