import type { RouteDefinition } from './shared.js';
import { writeSse } from '../response.js';

// TODO
export const eventRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/events/console',
        handler: ({request, response}) => {
            writeSse(response, request);
        },
    },
    {
        method: 'GET',
        path: '/api/v2/events/runtime',
        handler: ({request, response}) => {
            writeSse(response, request);
        },
    },
];
