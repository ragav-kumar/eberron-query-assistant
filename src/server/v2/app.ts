import { loadDefaultConfig } from '@/server/v1/config/index.js';
import type { RuntimeConfig } from '@/types.js';

import { createV2Orm } from './db/index.js';

export interface V2AppDependencies {
    config?: RuntimeConfig;
}

export const initializeV2App = async (dependencies: V2AppDependencies = {}): Promise<void> => {
    const config = dependencies.config ?? loadDefaultConfig();
    const orm = createV2Orm();

    try {
        await orm.bootstrap(config);
    } finally {
        orm.close();
    }
};
