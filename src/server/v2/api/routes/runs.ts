import type { RouteDefinition } from './shared.js';
import { DEFAULT_CREATED_RUN, RUNS } from '../mock-data.js';
import { writeNotFound } from '../not-found.js';
import { writeJson } from '../response.js';

export const runRoutes: RouteDefinition[] = [
    {
        method: 'POST',
        path: '/api/v2/runs',
        handler: ({response}) => {
            writeJson(response, DEFAULT_CREATED_RUN);
        },
    },
    {
        method: 'GET',
        path: '/api/v2/runs/:runId',
        handler: ({response, pathParams}) => {
            if (pathParams.runId == null) {
                writeNotFound(response);
                return;
            }

            const run = RUNS.get(pathParams.runId);
            if (run == null) {
                writeNotFound(response);
                return;
            }

            writeJson(response, run);
        },
    },
];
