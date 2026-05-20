import type { IncomingMessage, ServerResponse } from 'node:http';

import FindMyWay from 'find-my-way';
import type { V2AppContext } from '../app.js';
import { writeNotFound } from './not-found.js';
import { additionalContextRoutes } from './routes/additional-context.js';
import { eventRoutes } from './routes/events.js';
import { npcRoutes } from './routes/npcs.js';
import { refreshRoutes } from './routes/refresh.js';
import { runRoutes } from './routes/runs.js';
import { sessionRoutes } from './routes/sessions.js';
import type { RouteDefinition } from './routes/shared.js';
import { writeGenericJson } from './response.js';

const routes: RouteDefinition[] = [
    ...additionalContextRoutes,
    ...sessionRoutes,
    ...runRoutes,
    ...npcRoutes,
    ...refreshRoutes,
    ...eventRoutes,
];

export const createV2ApiHandler = (app: V2AppContext) => {
    const router = FindMyWay({
        defaultRoute: (_request, response) => {
            writeNotFound(response);
        },
    });

    for (const route of routes) {
        router.on(route.method, route.path, async (request, response, params) => {
            const url = new URL(request.url ?? '/', 'http://urldoesnotmatter.invalid');
            const queryParams: Record<string, string> = {};
            for (const [key, value] of url.searchParams) {
                queryParams[key] = value;
            }
            try {
                await route.handler({
                    context: app,
                    pathParams: params,
                    queryParams,
                    request,
                    response,
                });
            } catch (error) {
                console.error(error);
                if (!response.headersSent && !response.writableEnded) {
                    writeGenericJson(response, 500, {
                        error: 'Internal server error',
                    });
                }
            }
        });
    }

    return (request: IncomingMessage, response: ServerResponse): void => {
        router.lookup(request, response);
    };
};
