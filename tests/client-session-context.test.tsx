// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { ReactNode } from 'react';
import { SessionProvider } from '@client/components/SessionContext/SessionProvider.js';
import { useSessionContext } from '@client/components/SessionContext/SessionContext.js';
import { SessionDto, SessionFeedDto, RunDto } from '@/client/api/index.js';

vi.mock('react-markdown', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('remark-gfm', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
    useSessionsQuery: vi.fn(),
    useSessionFeedsQuery: vi.fn(),
    useRefreshQuery: vi.fn(),
}));

vi.mock('@/client/api/index.js', () => ({
    sessionModes: ['assistant', 'npc'],
    useSessionsQuery: apiMocks.useSessionsQuery,
    useSessionFeedsQuery: apiMocks.useSessionFeedsQuery,
    useRefreshQuery: apiMocks.useRefreshQuery,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeSession = (id: string, mode: 'assistant' | 'npc' = 'assistant', overrides?: Partial<SessionDto>): SessionDto => ({
    id,
    mode,
    title: `Session ${id}`,
    runCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    activeRunId: null,
    includePartyContext: null,
    ...overrides,
});

const makeRun = (id: string, sessionId: string, overrides?: Partial<RunDto>): RunDto => ({
    id,
    sessionId,
    mode: 'assistant',
    status: 'completed',
    updatedAt: '2024-01-01T00:00:00.000Z',
    sessionEntries: [],
    ...overrides,
});

/**
 * Dynamic feed map for the useSessionFeedsQuery mock. Tests populate this
 * before rendering so the mock returns the correct feed per session ID.
 */
const feedMap: Record<string, SessionFeedDto> = {};

const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider>{children}</SessionProvider>
);

// ── Setup ────────────────────────────────────────────────────────────────────

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    // Clear feed map between tests.
    for (const key of Object.keys(feedMap)) {
        delete feedMap[key];
    }
    apiMocks.useSessionsQuery.mockReturnValue({ data: [], isLoading: false, isPending: false });
    // Return feeds keyed by session ID so assertions work after changeActiveSession.
    apiMocks.useSessionFeedsQuery.mockImplementation((ids: string[]) =>
        ids.map(id => ({ data: feedMap[id], isLoading: false, isPending: false })),
    );
    apiMocks.useRefreshQuery.mockReturnValue({ data: { refreshStatus: 'completed', reingestStatus: 'pending' }, isLoading: false, isPending: false });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('V2 client session context', () => {
    it('constructs active sessions by joining session summaries with feed data', () => {
        const session = makeSession('session-1');
        const run = makeRun('run-1', 'session-1');
        feedMap['session-1'] = { sessionId: 'session-1', mode: 'assistant', items: [run] };
        apiMocks.useSessionsQuery.mockReturnValue({ data: [session], isLoading: false, isPending: false });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        act(() => {
            result.current.changeActiveSession('session-1', 'assistant');
        });

        expect(result.current.activeSessions.assistant).toMatchObject({
            id: 'session-1',
            title: 'Session session-1',
            runs: [expect.objectContaining({ id: 'run-1' })],
        });
    });

    it('keeps sessions separated by mode', () => {
        const assistantSession = makeSession('a-1', 'assistant');
        const npcSession = makeSession('n-1', 'npc');
        feedMap['a-1'] = { sessionId: 'a-1', mode: 'assistant', items: [] };
        feedMap['n-1'] = { sessionId: 'n-1', mode: 'npc', items: [] };
        apiMocks.useSessionsQuery.mockReturnValue({
            data: [assistantSession, npcSession],
            isLoading: false,
            isPending: false,
        });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        act(() => {
            result.current.changeActiveSession('a-1', 'assistant');
            result.current.changeActiveSession('n-1', 'npc');
        });

        expect(result.current.activeSessions.assistant?.id).toBe('a-1');
        expect(result.current.activeSessions.npc?.id).toBe('n-1');
    });

    it('patches only the active tab input state', () => {
        const { result } = renderHook(() => useSessionContext(), { wrapper });

        act(() => {
            result.current.patchActiveTabState({ prompt: 'hello world' });
        });

        // Active tab (assistant) reflects the patch.
        expect(result.current.activeTabState.prompt).toBe('hello world');
        expect(result.current.activeTabState.key).toBe('assistant');

        // Switching to npc shows the original untouched default.
        act(() => {
            result.current.changeActiveTab('npc');
        });
        expect(result.current.activeTabState.prompt).toBe('');
    });

    it('changes the active session id per mode', () => {
        const session = makeSession('session-1');
        feedMap['session-1'] = { sessionId: 'session-1', mode: 'assistant', items: [] };
        apiMocks.useSessionsQuery.mockReturnValue({ data: [session], isLoading: false, isPending: false });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        expect(result.current.activeSessions.assistant).toBeUndefined();
        expect(result.current.activeSessions.npc).toBeUndefined();

        act(() => {
            result.current.changeActiveSession('session-1', 'assistant');
        });

        expect(result.current.activeSessions.assistant?.id).toBe('session-1');
        expect(result.current.activeSessions.npc).toBeUndefined();
    });

    it('reports busy while sessions or feeds are loading', () => {
        apiMocks.useSessionsQuery.mockReturnValue({ data: undefined, isLoading: true, isPending: true });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        expect(result.current.isBusy).toBe(true);
    });

    it('reports busy while a refresh operation is running', () => {
        apiMocks.useRefreshQuery.mockReturnValue({
            data: { refreshStatus: 'running', reingestStatus: 'pending' },
            isLoading: false,
            isPending: false,
        });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        expect(result.current.isBusy).toBe(true);
    });

    it('reports busy while a reingest operation is running', () => {
        apiMocks.useRefreshQuery.mockReturnValue({
            data: { refreshStatus: 'completed', reingestStatus: 'running' },
            isLoading: false,
            isPending: false,
        });

        const { result } = renderHook(() => useSessionContext(), { wrapper });

        expect(result.current.isBusy).toBe(true);
    });

    it('initializes assistant and npc tab state from tab definitions', () => {
        const { result } = renderHook(() => useSessionContext(), { wrapper });

        expect(result.current.activeTabState).toEqual({
            key: 'assistant',
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        });
    });
});
