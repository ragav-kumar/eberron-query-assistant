import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Endpoint, SseEndpoint } from '@/contracts.v2.js';
import { v2Contracts } from '@/contracts.v2.js';

const NOT_IMPLEMENTED_MESSAGE = 'API v2 is not implemented.';

export const handleV2ApiRequest = (
    request: IncomingMessage,
    response: ServerResponse,
): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (matchesV2Route(request.method ?? 'GET', url.pathname)) {
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

const matchesV2Route = (method: string, pathname: string): boolean => {
    return collectEndpoints(v2Contracts).some((endpoint) => {
        if (endpoint.method !== method) {
            return false;
        }

        const pattern = new RegExp(
            `^${endpoint.path.replace(/:[^/]+/g, '[^/]+')}$`,
        );
        return pattern.test(pathname);
    });
};

const collectEndpoints = (value: unknown): Array<Endpoint<unknown, unknown> | SseEndpoint<unknown>> => {
    if (isEndpoint(value) || isSseEndpoint(value)) {
        return [value];
    }

    if (typeof value !== 'object' || value === null) {
        return [];
    }

    return Object.values(value).flatMap((entry) => collectEndpoints(entry));
};

const isEndpoint = (value: unknown): value is Endpoint<unknown, unknown> => {
    return (
        typeof value === 'object' &&
        value !== null &&
        'transport' in value &&
        value.transport === 'http' &&
        'method' in value &&
        typeof value.method === 'string' &&
        'path' in value &&
        typeof value.path === 'string'
    );
};

const isSseEndpoint = (value: unknown): value is SseEndpoint<unknown> => {
    return (
        typeof value === 'object' &&
        value !== null &&
        'transport' in value &&
        value.transport === 'sse' &&
        'method' in value &&
        value.method === 'GET' &&
        'path' in value &&
        typeof value.path === 'string'
    );
};
