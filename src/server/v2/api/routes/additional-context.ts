import type { RouteDefinition } from './shared.js';
import { readText } from '../request.js';
import { writeMarkdown } from '../response.js';
import { settingKeys, Settings } from '@/server/v2/db-app/settingKeys.js';

export const additionalContextRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/additional-context',
        handler: async ({response, context}) => {
            const markdown = await Settings.read(context.db, settingKeys.additionalContext) ?? '';
            writeMarkdown(response, markdown);
        },
    },
    {
        method: 'PUT',
        path: '/api/v2/additional-context',
        handler: async ({request, response, context}) => {
            const markdown = await readText(request);
            await Settings.write(context.db, settingKeys.additionalContext, markdown);

            writeMarkdown(response, markdown);
        },
    },
];
