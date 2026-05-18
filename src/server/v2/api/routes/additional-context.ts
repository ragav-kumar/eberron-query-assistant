import type { RouteDefinition } from './shared.js';

import { ADDITIONAL_CONTEXT_MARKDOWN } from '../mock-data.js';
import { writeText } from '../response.js';

export const additionalContextRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/additional-context',
        handler: (_request, response) => {
            writeText(response, 200, ADDITIONAL_CONTEXT_MARKDOWN, 'text/markdown; charset=utf-8');
        },
    },
    {
        method: 'PUT',
        path: '/api/v2/additional-context',
        handler: (_request, response) => {
            writeText(response, 200, ADDITIONAL_CONTEXT_MARKDOWN, 'text/markdown; charset=utf-8');
        },
    },
];
