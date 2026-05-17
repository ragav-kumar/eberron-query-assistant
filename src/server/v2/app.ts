import { loadDefaultConfig } from '@/server/v1/config/index.js';
import type { RuntimeConfig } from '@/types.js';

import { createOrm } from './db/index.js';

export interface V2AppDependencies {
    config?: RuntimeConfig;
}

export const initializeV2App = async (dependencies: V2AppDependencies = {}): Promise<void> => {
    const config = dependencies.config ?? loadDefaultConfig();
    const orm = createOrm(config);

    try {
        await orm.bootstrap();
    } finally {
        orm.close();
    }
};
