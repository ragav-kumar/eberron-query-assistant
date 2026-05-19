import type { RouteDefinition } from './shared.js';
import { writeJson } from '../response.js';

export const consoleRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/console',
        handler: async ({response, context}) => {
            writeJson(response, await context.consoleEvents.snapshot());
        },
    },
];
