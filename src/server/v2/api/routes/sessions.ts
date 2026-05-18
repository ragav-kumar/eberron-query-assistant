import type { RouteDefinition } from './shared.js';

import { SESSION_FEEDS, SESSIONS } from '../mock-data.js';
import { writeNotFound } from '../not-found.js';
import { writeJson } from '../response.js';

export const sessionRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/sessions',
        handler: ({request, response}) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            const mode = url.searchParams.get('mode');
            writeJson(
                response,
                200,
                mode == null ? SESSIONS : SESSIONS.filter(session => session.mode === mode),
            );
        },
    },
    {
        method: 'GET',
        path: '/api/v2/sessions/:sessionId/feed',
        handler: ({response, params}) => {
            if (params.sessionId == null) {
                writeNotFound(response);
                return;
            }

            const feed = SESSION_FEEDS.get(params.sessionId);
            if (feed == null) {
                writeNotFound(response);
                return;
            }

            writeJson(response, 200, feed);
        },
    },
];
