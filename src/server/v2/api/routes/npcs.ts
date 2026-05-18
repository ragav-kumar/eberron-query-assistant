import type { RouteDefinition } from './shared.js';

import { NPCS } from '../mock-data.js';
import { writeJson } from '../response.js';

export const npcRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/npcs',
        handler: (_request, response) => {
            writeJson(response, 200, NPCS);
        },
    },
];
