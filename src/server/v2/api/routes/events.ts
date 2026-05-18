import type { RouteDefinition } from './shared.js';
import { writeSse } from '../response.js';

export const eventRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/events/console',
        handler: ({request, response}) => {
            // TODO: Stream real console events once the event publisher is wired up.
            console.warn('GET /api/v2/events/console is not implemented');
            writeSse(response, request);
        },
    },
    {
        method: 'GET',
        path: '/api/v2/events/runtime',
        handler: ({request, response}) => {
            // TODO: Stream real runtime events once the event publisher is wired up.
            console.warn('GET /api/v2/events/runtime is not implemented');
            writeSse(response, request);
        },
    },
];
