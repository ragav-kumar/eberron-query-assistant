import type { RouteDefinition } from './shared.js';
import { readText } from '../request.js';
import { writeMarkdown } from '../response.js';
import { settingsStore } from '@server/db/app/index.js';

export const additionalContextRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/additional-context',
        handler: ({response}) => {
            const markdown = settingsStore().read('additionalContext');
            writeMarkdown(response, markdown);
        },
    },
    {
        method: 'PUT',
        path: '/api/v2/additional-context',
        handler: async ({request, response, context}) => {
            const markdown = await readText(request);
            await settingsStore().write(context, 'additionalContext', markdown);

            writeMarkdown(response, markdown);
        },
    },
];
