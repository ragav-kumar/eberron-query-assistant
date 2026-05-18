import type { RouteDefinition } from './shared.js';
import { readText } from '../request.js';
import { writeText } from '../response.js';

export const additionalContextRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/additional-context',
        handler: async ({response, context}) => {

            const additionalContext = await context.db
                .selectFrom('settings')
                .select('value')
                .where('key', '=', 'additional-context')
                .execute();

            let markdown = '';
            if (additionalContext.length > 0 && additionalContext[0] != null) {
                markdown = additionalContext[0].value;
            }

            writeText(response, 200, markdown, 'text/markdown; charset=utf-8');
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
                .values({key: 'additional-context', value: markdown, modifiedAt})
                .onConflict(conflict => conflict.column('key').doUpdateSet({
                    value: markdown,
                    modifiedAt,
                }))
                .execute();

            writeText(response, 200, markdown, 'text/markdown; charset=utf-8');
        },
    },
];