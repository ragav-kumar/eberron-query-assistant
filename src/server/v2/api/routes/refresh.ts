import type { RouteDefinition } from './shared.js';
import { REFRESH } from '../mock-data.js';
import { writeJson } from '../response.js';

export const refreshRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/refresh',
        handler: ({response}) => {
            writeJson(response, REFRESH);
        },
    },
    {
        method: 'POST',
        path: '/api/v2/refresh',
        handler: ({response}) => {
            writeJson(response, REFRESH);
        },
    },
];
