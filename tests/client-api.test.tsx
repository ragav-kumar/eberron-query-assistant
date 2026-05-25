// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

import { sessionQueryKey, useSessionFeedsQuery } from '@/client/api/hooks/sessions.js';
import { refreshQueryKey, useRefreshMutation } from '@/client/api/hooks/refresh.js';
import { useAdditionalContextMutation } from '@/client/api/hooks/additionalContext.js';
import { useRuntimeSubscription } from '@/client/api/hooks/runtime.js';
import { useConsoleEntries, useConsoleSubscription } from '@/client/api/hooks/console.js';
import { RefreshDto } from '@/dto/index.js';

type EventSourceMock = {
    close: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
};

let queryClient: QueryClient;
let mockEventSourceInstance: EventSourceMock;

/**
 * Closes over the outer `queryClient` variable so each test gets a fresh client
 * without needing to re-define the wrapper.
 */
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
    queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    mockEventSourceInstance = { close: vi.fn(), onmessage: null };
    vi.stubGlobal('EventSource', vi.fn(() => mockEventSourceInstance));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    queryClient.clear();
});

const makeRefreshDto = (overrides?: Partial<RefreshDto>): RefreshDto => ({
    activeOperation: null,
    lastRefreshAt: '2024-01-01T00:00:00.000Z',
    lastReingestAt: null,
    refreshStatus: 'completed',
    reingestStatus: 'completed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
});

describe('V2 client API hooks', () => {
    it('builds session feed queries only for non-empty session ids', () => {
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

        const { result } = renderHook(() => useSessionFeedsQuery(['', 'session-1']), { wrapper });

        // Empty string → enabled: false → fetchStatus is idle, never fires a request.
        expect(result.current[0]!.fetchStatus).toBe('idle');
    });

    it('updates cached refresh state optimistically after refresh success', async () => {
        const refreshDto = makeRefreshDto();
        vi.spyOn(global, 'fetch').mockResolvedValue(
            new Response(JSON.stringify(refreshDto), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const { result } = renderHook(() => useRefreshMutation(), { wrapper });

        act(() => { result.current.mutate({ kind: 'refresh' }); });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryClient.getQueryData(refreshQueryKey)).toEqual(refreshDto);
    });

    it('optimistically updates additional context and rolls back on mutation failure', async () => {
        queryClient.setQueryData(['api', 'context'], 'original');
        vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useAdditionalContextMutation(), { wrapper });

        act(() => { result.current.mutate('new text'); });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(queryClient.getQueryData(['api', 'context'])).toBe('original');
    });

    it('invalidates session and feed queries for run runtime events', () => {
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

        renderHook(() => useRuntimeSubscription(), { wrapper });

        act(() => {
            mockEventSourceInstance.onmessage!({
                data: JSON.stringify({ resource: 'run', sessionId: 'sess-1' }),
            } as MessageEvent);
        });

        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: sessionQueryKey }),
        );
        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: [...sessionQueryKey, 'sess-1', 'feed'] }),
        );
    });

    it('invalidates refresh queries for refresh runtime events', () => {
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

        renderHook(() => useRuntimeSubscription(), { wrapper });

        act(() => {
            mockEventSourceInstance.onmessage!({
                data: JSON.stringify({ resource: 'refresh' }),
            } as MessageEvent);
        });

        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: refreshQueryKey }),
        );
    });

    it('invalidates the correct feed queries for session-entry events', () => {
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

        renderHook(() => useRuntimeSubscription(), { wrapper });

        act(() => {
            mockEventSourceInstance.onmessage!({
                data: JSON.stringify({ resource: 'session-entry', sessionId: 'sess-2' }),
            } as MessageEvent);
        });

        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: [...sessionQueryKey, 'sess-2', 'feed'] }),
        );
    });

    it('invalidates both replacement and promoted session feeds for session events', () => {
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

        renderHook(() => useRuntimeSubscription(), { wrapper });

        act(() => {
            mockEventSourceInstance.onmessage!({
                data: JSON.stringify({
                    resource: 'session',
                    sessionId: 'new-sess',
                    replacedSessionId: 'old-sess',
                }),
            } as MessageEvent);
        });

        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: [...sessionQueryKey, 'new-sess', 'feed'] }),
        );
        expect(invalidateQueries).toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: [...sessionQueryKey, 'old-sess', 'feed'] }),
        );
    });

    it('deduplicates console SSE entries by id', () => {
        const entry = { id: 'entry-1', kind: 'info', message: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' };

        // Render both hooks in the same tree so act() flushes updates for both.
        const { result } = renderHook(() => {
            useConsoleSubscription();
            return useConsoleEntries();
        }, { wrapper });

        act(() => {
            mockEventSourceInstance.onmessage!({ data: JSON.stringify(entry) } as MessageEvent);
            mockEventSourceInstance.onmessage!({ data: JSON.stringify(entry) } as MessageEvent);
        });

        expect(result.current).toHaveLength(1);
    });

    it('closes EventSource subscriptions on unmount', () => {
        const { unmount } = renderHook(() => useRuntimeSubscription(), { wrapper });

        unmount();

        expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });
});
