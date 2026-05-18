import type { RouteDefinition } from './shared.js';
import { readText } from '../request.js';
import { writeMarkdown } from '../response.js';
import { settingKeys } from '@/server/v2/db-app/settingKeys.js';

export const additionalContextRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/additional-context',
        handler: async ({response, context}) => {

            const additionalContext = await context.db
                .selectFrom('settings')
                .select('value')
                .where('key', '=', settingKeys.additionalContext)
                .execute();

            let markdown = '';
            if (additionalContext.length > 0 && additionalContext[0] != null) {
                markdown = additionalContext[0].value;
            }

            writeMarkdown(response, markdown);
        },
    },
    {
        method: 'PUT',
        path: '/api/v2/additional-context',
        handler: async ({request, response, context}) => {
            const markdown = await readText(request);
            const modifiedAt = new Date().toISOString();

            await context.db
                .insertInto('settings')
                .values({key: settingKeys.additionalContext, value: markdown, modifiedAt})
                .onConflict(conflict => conflict.column('key').doUpdateSet({
                    value: markdown,
                    modifiedAt,
                }))
                .execute();

            writeMarkdown(response, markdown);
        },
    },
];
