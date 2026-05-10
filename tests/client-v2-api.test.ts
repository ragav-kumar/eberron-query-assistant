// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { v2Contracts } from '../src/contracts.v2.js';
import { mutateApi, queryApi } from '../src/client/v2/api/utils.js';

describe('v2 client API helpers', () => {
    const fetchMock = vi.fn<typeof fetch>();

    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses endpoint-defined headers and text parsing for markdown queries', async () => {
        fetchMock.mockResolvedValue(new Response('# Campaign Notes', {
            headers: {
                'Content-Type': 'text/markdown; charset=utf-8',
            },
            status: 200,
        }));

        const response = await queryApi(v2Contracts.additionalContext.get);

        expect(response).toBe('# Campaign Notes');
        expect(fetchMock).toHaveBeenCalledWith('/api/v2/additional-context', {
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'GET',
        });
    });

    it('serializes markdown mutations from endpoint-defined headers', async () => {
        fetchMock.mockResolvedValue(new Response('Updated context', {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
            status: 200,
        }));

        const response = await mutateApi(v2Contracts.additionalContext.put, '# Session Prep');

        expect(response).toBe('Updated context');
        expect(fetchMock).toHaveBeenCalledWith('/api/v2/additional-context', {
            body: '# Session Prep',
            headers: {
                'Content-Type': 'text/markdown',
            },
            method: 'PUT',
        });
    });

    it('keeps JSON defaults on standard endpoints and removes undefined query params', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ entries: [] }), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
            status: 200,
        }));

        await queryApi(v2Contracts.sessions.get);

        expect(fetchMock).toHaveBeenCalledWith('/api/v2/sessions', {
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'GET',
        });
    });

    it('fills path params before sending requests', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'run-1' }), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
            status: 200,
        }));

        await queryApi(v2Contracts.runs.get, {
            runId: 'run-1',
        });

        expect(fetchMock).toHaveBeenCalledWith('/api/v2/runs/run-1', {
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'GET',
        });
    });
});
