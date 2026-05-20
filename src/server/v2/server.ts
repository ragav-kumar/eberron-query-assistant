import type { IncomingMessage, ServerResponse } from 'node:http';

import {
    createV2App,
    type CreateV2AppDependencies,
} from './app.js';
import { createV2ApiHandler } from './api/index.js';

export interface V2ServerRuntime {
    close: () => Promise<void>;
    handleRequest: (request: IncomingMessage, response: ServerResponse) => void;
}

export const createV2ServerRuntime = async (
    dependencies: CreateV2AppDependencies = {},
): Promise<V2ServerRuntime> => {
    const app = await createV2App(dependencies);

    return {
        close: app.close,
        handleRequest: createV2ApiHandler(app),
    };
};
