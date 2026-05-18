import type { RouteDefinition } from './shared.js';

import { REFRESH } from '../mock-data.js';
import { writeJson } from '../response.js';

export const refreshRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/refresh',
        handler: (_request, response) => {
            writeJson(response, 200, REFRESH);
        },
    },
    {
        method: 'POST',
        path: '/api/v2/refresh',
        handler: (_request, response) => {
            writeJson(response, 200, REFRESH);
        },
    },
];
