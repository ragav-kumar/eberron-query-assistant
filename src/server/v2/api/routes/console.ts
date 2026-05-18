import type { RouteDefinition } from './shared.js';

import { CONSOLE_ENTRIES } from '../mock-data.js';
import { writeJson } from '../response.js';

export const consoleRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/console',
        handler: ({response}) => {
            writeJson(response, 200, CONSOLE_ENTRIES);
        },
    },
];
