import type { RouteDefinition } from './shared.js';
import { DEFAULT_CREATED_RUN } from '../mock-data.js';
import { writeJson } from '../response.js';

export const runRoutes: RouteDefinition[] = [
    {
        method: 'POST',
        path: '/api/v2/runs',
        handler: ({response}) => {
            writeJson(response, DEFAULT_CREATED_RUN);
        },
    },
];
