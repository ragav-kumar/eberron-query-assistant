import type { IncomingMessage, ServerResponse } from 'node:http';

export const writeGenericJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
};

export const writeJson = (response: ServerResponse, body: unknown): void => {
    writeGenericJson(response, 200, body);
};

export const writeText = (response: ServerResponse, body: string, contentType: string): void => {
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType);
    response.end(body);
};

export const writeMarkdown = (response: ServerResponse, body: string): void => {
    writeText(response, body, 'text/markdown; charset=utf-8');
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
