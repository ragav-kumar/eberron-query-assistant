import { RouteDefinition } from './shared.js';
import { writeSse } from '../response.js';

export const eventRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/events/console',
        handler: ({request, response, context}) => {
            writeSse(response, request);
            const unsubscribe = context.consoleEvents.subscribe(entry => {
                response.write?.(`data: ${JSON.stringify(entry)}\n\n`);
            });
            request.on('close', () => {
                unsubscribe();
            });
        },
    },
    {
        method: 'GET',
        path: '/api/v2/events/runtime',
        handler: ({request, response, context}) => {
            writeSse(response, request);
            const unsubscribe = context.runtimeEvents.subscribe(event => {
                response.write?.(`data: ${JSON.stringify(event)}\n\n`);
            });
            request.on('close', () => {
                unsubscribe();
            });
        },
    },
];
