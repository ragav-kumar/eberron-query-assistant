import type { RouteDefinition } from './shared.js';
import { writeJson } from '../response.js';
import { ConsoleEntry } from '@/dto/index.js';

export const consoleRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/console',
        handler: async ({response, context}) => {
            const entries = await context.db
                .selectFrom('consoleEntries')
                .selectAll()
                .orderBy('createdAt', 'asc')
                .execute();

            const dtos = entries.map<ConsoleEntry>(entry => ({
                id: entry.id,
                level: entry.level,
                message: entry.message,
                timestamp: entry.createdAt,
            }));

            writeJson(response, dtos);
        },
    },
];
