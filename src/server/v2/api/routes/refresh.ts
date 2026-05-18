import type { RouteDefinition } from './shared.js';
import { writeJson } from '../response.js';

export const refreshRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/refresh',
        handler: async ({response, context}) => {
            const refresh = await context.db
                .selectFrom('refreshState')
                .selectAll()
                .executeTakeFirstOrThrow();

            writeJson(response, refresh);
        },
    },
    {
        method: 'POST',
        path: '/api/v2/refresh',
        handler: async ({response, context}) => {
            // TODO: Rework this once refresh POST behavior is implemented.
            console.warn('POST /api/v2/refresh is not implemented');

            const refresh = await context.db
                .selectFrom('refreshState')
                .selectAll()
                .executeTakeFirstOrThrow();

            writeJson(response, refresh);
        },
    },
];
