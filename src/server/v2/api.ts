import type { IncomingMessage, ServerResponse } from 'node:http';

import { v2Contracts } from '@/contracts.v2.js';

const NOT_IMPLEMENTED_MESSAGE = 'API v2 is not implemented.';

const V2_PATHS = new Set(Object.values(v2Contracts).map((endpoint) => endpoint.path));

export const handleV2ApiRequest = (
    request: IncomingMessage,
    response: ServerResponse,
): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (V2_PATHS.has(url.pathname)) {
        writeJson(response, 501, {error: NOT_IMPLEMENTED_MESSAGE});
        return;
    }

    writeJson(response, 404, {error: 'Unknown API route.'});
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
};
