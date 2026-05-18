import type { RouteDefinition } from './shared.js';

import { writeSse } from '../response.js';

export const eventRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/console/events',
        handler: (request, response) => {
            writeSse(response, request);
        },
    },
    {
        method: 'GET',
        path: '/api/v2/runtime/events',
        handler: (request, response) => {
            writeSse(response, request);
        },
    },
];
