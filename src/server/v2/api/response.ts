import type { IncomingMessage, ServerResponse } from 'node:http';

export const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
};

export const writeText = (response: ServerResponse, statusCode: number, body: string, contentType: string): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', contentType);
    response.end(body);
};

export const writeSse = (response: ServerResponse, request: IncomingMessage): void => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();
    response.write?.(': connected\n\n');
    request.on('close', () => {
        response.end();
    });
};
