import { RouteDefinition } from './shared.js';
import { readJson } from '../request.js';
import { writeJson, writeErrorJson } from '../response.js';
import { CreateRunDto, LEGACY_NPC_SESSION_ID } from '@/dto/index.js';

export const runRoutes: RouteDefinition[] = [
    {
        method: 'POST',
        path: '/api/v2/runs',
        handler: async ({request, response, context}) => {
            const payload = await readJson<CreateRunDto>(request);
            if (payload.sessionId === LEGACY_NPC_SESSION_ID) {
                writeErrorJson(response, 400, 'This session is read-only and cannot be resumed.');
                return;
            }
            const run = await context.runCoordinator.startRun(payload);
            writeJson(response, run);
        },
    },
];
