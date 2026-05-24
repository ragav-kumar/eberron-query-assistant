import type { RouteDefinition } from './shared.js';
import { readJson } from '../request.js';
import { writeJson } from '../response.js';
import type { CreateRunDto } from '@/dto/index.js';

export const runRoutes: RouteDefinition[] = [
    {
        method: 'POST',
        path: '/api/v2/runs',
        handler: async ({request, response, context}) => {
            const payload = await readJson<CreateRunDto>(request);
            const run = await context.runCoordinator.startRun(payload);
            writeJson(response, run);
        },
    },
];
