import { RouteDefinition } from './shared.js';
import { readJson } from '../request.js';
import { writeJson } from '../response.js';
import { CreateRefreshDto } from '@/dto/index.js';

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
        handler: async ({request, response, context}) => {
            const payload = await readJson<CreateRefreshDto>(request);
            const refresh = await context.refreshCoordinator.startRefresh(payload);
            writeJson(response, refresh);
        },
    },
];
