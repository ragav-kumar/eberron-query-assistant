import type { RouteDefinition } from './shared.js';
import { DEFAULT_CREATED_RUN } from '../mock-data.js';
import { writeJson } from '../response.js';

export const runRoutes: RouteDefinition[] = [
    {
        method: 'POST',
        path: '/api/v2/runs',
        handler: ({response}) => {
            // TODO: Replace this placeholder response once run creation is implemented.
            console.warn('POST /api/v2/runs is not implemented');
            writeJson(response, DEFAULT_CREATED_RUN);
        },
    },
];
