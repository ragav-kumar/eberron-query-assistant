import { IncomingMessage, ServerResponse } from 'node:http';

import { isRecord } from '@/errors.js';

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

export const writeErrorJson = (response: ServerResponse, statusCode: number, message: string): void => {
    writeGenericJson(response, statusCode, {error: message});
};

export const toApiErrorResponse = (error: unknown): {message: string; statusCode: number} => {
    if (isRecord(error) && typeof error.kind === 'string' && typeof error.message === 'string') {
        switch (error.kind) {
            case 'run-blocked-refresh':
                return {message: error.message, statusCode: 409};
            case 'run-invalid-response':
            case 'run-invalid-thinking':
            case 'run-prompt-empty':
            case 'run-session-required':
            case 'run-unsupported-mode':
                return {message: error.message, statusCode: 400};
            case 'run-session-missing':
            case 'run-session-mode-mismatch':
                return {message: error.message, statusCode: 404};
            default:
                return {message: error.message, statusCode: 500};
        }
    }

    return {
        message: 'Internal server error',
        statusCode: 500,
    };
};
