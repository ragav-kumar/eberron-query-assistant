import type { IncomingMessage, ServerResponse } from 'node:http';

import FindMyWay from 'find-my-way';
import { writeNotFound } from './not-found.js';
import { additionalContextRoutes } from './routes/additional-context.js';
import { consoleRoutes } from './routes/console.js';
import { eventRoutes } from './routes/events.js';
import { npcRoutes } from './routes/npcs.js';
import { refreshRoutes } from './routes/refresh.js';
import { runRoutes } from './routes/runs.js';
import { sessionRoutes } from './routes/sessions.js';
import type { RouteDefinition } from './routes/shared.js';

const router = FindMyWay({
    defaultRoute: (_request, response) => {
        writeNotFound(response);
    },
});

const routes: RouteDefinition[] = [
    ...additionalContextRoutes,
    ...sessionRoutes,
    ...runRoutes,
    ...npcRoutes,
    ...refreshRoutes,
    ...consoleRoutes,
    ...eventRoutes,
];

for (const route of routes) {
    router.on(route.method, route.path, (request, response, params) => {
        route.handler(
            request,
            response,
            params,
        );
    });
}

export const handleV2ApiRequest = (
    request: IncomingMessage,
    response: ServerResponse,
): void => {
    router.lookup(request, response);
};
