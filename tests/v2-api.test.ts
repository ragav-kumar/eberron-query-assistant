import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createV2ApiHandler } from '@/server/v2/api/index.js';
import type { V2AppContext } from '@/server/v2/app.js';

class MockRequest extends EventEmitter {
    method?: string;
    url?: string;
}

interface ResponseRecord {
    body: string;
    ended: boolean;
    flushHeadersCalls: number;
    headers: Record<string, string>;
    statusCode: number;
    writes: string[];
}

const createResponse = (): { record: ResponseRecord; response: ServerResponse } => {
    const record: ResponseRecord = {
        body: '',
        ended: false,
        flushHeadersCalls: 0,
        headers: {},
        statusCode: 0,
        writes: [],
    };

    const response = {
        end: (body?: string) => {
            record.ended = true;
            if (body != null) {
                record.body = body;
            }
        },
        flushHeaders: () => {
            record.flushHeadersCalls += 1;
        },
        setHeader: (name: string, value: string) => {
            record.headers[name] = value;
        },
        statusCode: 0,
        write: (chunk: string) => {
            record.writes.push(chunk);
            return true;
        },
    } as Partial<ServerResponse>;

    Object.defineProperty(response, 'statusCode', {
        get: () => record.statusCode,
        set: (value: number) => {
            record.statusCode = value;
        },
    });

    return {record, response: response as ServerResponse};
};

const createRequest = (method: string, url: string): IncomingMessage => {
    const request = new MockRequest();
    request.method = method;
    request.url = url;
    return request as IncomingMessage;
};

const testApp: V2AppContext = {
    close: () => Promise.resolve(),
    db: {} as V2AppContext['db'],
};

const handleV2ApiRequest = createV2ApiHandler(testApp);

describe('V2 API router', () => {
    it('returns additional context markdown unchanged', () => {
        const request = createRequest('GET', '/api/v2/additional-context');
        const {record, response} = createResponse();

        handleV2ApiRequest(request, response);

        expect(record.statusCode).toBe(200);
        expect(record.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
        expect(record.body).toContain('# Campaign Context');
    });

    it('preserves session mode filtering', () => {
        const request = createRequest('GET', '/api/v2/sessions?mode=assistant');
        const {record, response} = createResponse();

        handleV2ApiRequest(request, response);

        const sessions = JSON.parse(record.body) as Array<{ mode: string }>;

        expect(record.statusCode).toBe(200);
        expect(sessions).toHaveLength(3);
        expect(sessions.every(session => session.mode === 'assistant')).toBe(true);
    });

    it('resolves session feed and run routes with path params', () => {
        const feedRequest = createRequest('GET', '/api/v2/sessions/session-dal-quor/feed');
        const feedResult = createResponse();

        handleV2ApiRequest(feedRequest, feedResult.response);

        expect(feedResult.record.statusCode).toBe(200);
        expect(JSON.parse(feedResult.record.body)).toMatchObject({
            sessionId: 'session-dal-quor',
        });

        const runRequest = createRequest('GET', '/api/v2/runs/run-dal-quor-1');
        const runResult = createResponse();

        handleV2ApiRequest(runRequest, runResult.response);

        expect(runResult.record.statusCode).toBe(200);
        expect(JSON.parse(runResult.record.body)).toMatchObject({
            id: 'run-dal-quor-1',
        });
    });

    it('returns the same 404 body for unknown routes', () => {
        const request = createRequest('GET', '/api/v2/not-a-route');
        const {record, response} = createResponse();

        handleV2ApiRequest(request, response);

        expect(record.statusCode).toBe(404);
        expect(record.headers['Content-Type']).toBe('application/json; charset=utf-8');
        expect(JSON.parse(record.body)).toEqual({error: 'Unknown API route.'});
    });

    it('does not match incomplete session feed paths', () => {
        const request = createRequest('GET', '/api/v2/sessions/session-dal-quor');
        const {record, response} = createResponse();

        handleV2ApiRequest(request, response);

        expect(record.statusCode).toBe(404);
        expect(JSON.parse(record.body)).toEqual({error: 'Unknown API route.'});
    });

    it('preserves SSE headers and connection prelude', () => {
        const request = createRequest('GET', '/api/v2/console/events');
        const {record, response} = createResponse();

        handleV2ApiRequest(request, response);

        expect(record.statusCode).toBe(200);
        expect(record.headers).toMatchObject({
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Content-Type': 'text/event-stream; charset=utf-8',
        });
        expect(record.flushHeadersCalls).toBe(1);
        expect(record.writes).toEqual([': connected\n\n']);

        (request as unknown as MockRequest).emit('close');

        expect(record.ended).toBe(true);
    });
});
