import type { RouteDefinition } from './shared.js';
import { writeSse } from '../response.js';

export const eventRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/events/console',
        handler: ({request, response, context}) => {
            // TODO: Expand this route into the full SSE transport adapter layer.
            // The completed route should:
            // - open the SSE stream
            // - subscribe a callback with the publisher
            // - serialize ConsoleEntryDto values into SSE frames with response.write()
            // - unsubscribe that callback on request close
            console.warn('GET /api/v2/events/console SSE transport adapter is not implemented');
            writeSse(response, request);
            context.consoleEvents.registerConnection();
        },
    },
    {
        method: 'GET',
        path: '/api/v2/events/runtime',
        handler: ({request, response, context}) => {
            // TODO: Expand this route into the full SSE transport adapter layer.
            // The completed route should:
            // - open the SSE stream
            // - subscribe a callback with the publisher
            // - serialize OperationEventDto values into SSE frames with response.write()
            // - unsubscribe that callback on request close
            console.warn('GET /api/v2/events/runtime SSE transport adapter is not implemented');
            writeSse(response, request);
            context.runtimeEvents.registerConnection();
        },
    },
];
