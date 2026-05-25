// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ReactNode } from 'react';
import { Assistant } from '@client/components/Assistant/Assistant.js';
import { Input } from '@client/components/Input/Input.js';
import { SessionSelector } from '@client/components/SessionSelector.js';
import { NpcCards } from '@client/components/NpcCards/index.js';
import { AdditionalContextInput } from '@client/components/AdditionalContextInput.js';
import { TEMP_SESSION_ID } from '@client/components/SessionContext/SessionProvider.js';
import { NpcDto, RunDto, SessionDto } from '@/client/api/index.js';
import { SessionData } from '@client/components/SessionContext/SessionContext.js';
import { SessionMode } from '@/types.js';
import { SessionEntryDto } from '@/dto/runs.js';

vi.mock('react-markdown', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('remark-gfm', () => ({ default: () => null }));
vi.mock('@mdxeditor/editor', () => ({
    BoldItalicUnderlineToggles: () => null,
    headingsPlugin: () => null,
    listsPlugin: () => null,
    markdownShortcutPlugin: () => null,
    MDXEditor: ({ markdown }: { markdown: string }) => <div data-testid='mdxeditor'>{markdown}</div>,
    quotePlugin: () => null,
    toolbarPlugin: () => null,
    UndoRedo: () => null,
}));
vi.mock('@mdxeditor/editor/style.css', () => ({}));

const mocks = vi.hoisted(() => ({
    useSessionContext: vi.fn(),
    useRunsMutation: vi.fn(),
    useNpcsQuery: vi.fn(),
    useAdditionalContextQuery: vi.fn(),
    useAdditionalContextMutation: vi.fn(),
}));

vi.mock('@client/components/SessionContext/index.js', () => ({
    useSessionContext: mocks.useSessionContext,
    TEMP_SESSION_ID: '__temp__',
}));

vi.mock('@/client/api/index.js', () => ({
    sessionModes: ['assistant', 'npc'],
    useRunsMutation: mocks.useRunsMutation,
    useSessionsQuery: vi.fn().mockReturnValue({ data: [], isLoading: false, isPending: false }),
    useSessionFeedsQuery: vi.fn().mockReturnValue([]),
    useNpcsQuery: mocks.useNpcsQuery,
    useAdditionalContextQuery: mocks.useAdditionalContextQuery,
    useAdditionalContextMutation: mocks.useAdditionalContextMutation,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeNpc = (id: number, sessionId: string, overrides?: Partial<NpcDto>): NpcDto => ({
    id,
    name: `NPC ${id}`,
    description: `Description ${id}`,
    bio: `Bio ${id}`,
    sessionId,
    ...overrides,
});

const makeEntry = (id: string, runId: string, content: string, kind: SessionEntryDto['kind'] = 'user'): SessionEntryDto => ({
    id,
    kind,
    sessionId: 'session-1',
    runId,
    createdAt: '2024-01-01T00:00:00.000Z',
    content,
} as SessionEntryDto);

const makeRun = (id: string, sessionId: string, overrides?: Partial<RunDto>): RunDto => ({
    id,
    sessionId,
    mode: 'assistant',
    status: 'completed',
    updatedAt: '2024-01-01T00:00:00.000Z',
    sessionEntries: [],
    ...overrides,
});

const makeSessionData = (id: string, mode: SessionMode = 'assistant', overrides?: Partial<SessionData>): SessionData => ({
    id,
    mode,
    title: `Session ${id}`,
    runCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    activeRunId: null,
    includePartyContext: null,
    runs: [],
    ...overrides,
});

const makeContext = (overrides?: Record<string, unknown>) => ({
    isBusy: false,
    activeTabState: { key: 'assistant' as SessionMode, prompt: '', includePartyContext: true, retrievalTurnLimit: 1 },
    activeSessions: { assistant: undefined, npc: undefined } as Record<SessionMode, SessionData | undefined>,
    patchActiveTabState: vi.fn(),
    changeActiveSession: vi.fn(),
    createTempSession: vi.fn(),
    promoteSession: vi.fn(),
    changeActiveTab: vi.fn(),
    sessionsByMode: vi.fn().mockReturnValue([] as SessionDto[]),
    ...overrides,
});

// ── Setup ─────────────────────────────────────────────────────────────────────

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    // jsdom does not implement scrollIntoView; provide a no-op so effects using it don't throw.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.useSessionContext.mockReturnValue(makeContext());
    mocks.useRunsMutation.mockReturnValue({
        mutateAsync: vi.fn().mockResolvedValue(makeRun('run-1', 'session-1')),
    });
    mocks.useNpcsQuery.mockReturnValue({ data: { npcs: [], totalCount: 0, skip: 0, take: 20, filter: '' }, isLoading: false, isPending: false });
    mocks.useAdditionalContextQuery.mockReturnValue({ data: '', isLoading: false, isError: false });
    mocks.useAdditionalContextMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('V2 client components', () => {
    it('renders assistant exchanges grouped by run and ordered by session entry', () => {
        const session = makeSessionData('session-1', 'assistant', {
            runs: [
                makeRun('run-1', 'session-1', {
                    sessionEntries: [
                        makeEntry('e-1', 'run-1', 'What is Sharn?', 'user'),
                        makeEntry('e-2', 'run-1', 'Sharn is a city.', 'response'),
                    ],
                }),
                makeRun('run-2', 'session-1', {
                    sessionEntries: [
                        makeEntry('e-3', 'run-2', 'Tell me about Breland.', 'user'),
                    ],
                }),
            ],
        });
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: session, npc: undefined },
        }));

        render(<Assistant />);

        expect(document.getElementById('run-run-1')).toBeTruthy();
        expect(document.getElementById('run-run-2')).toBeTruthy();
        expect(document.getElementById('run-run-1-entry-e-1')).toBeTruthy();
        expect(document.getElementById('run-run-1-entry-e-2')).toBeTruthy();
        expect(screen.getAllByText('What is Sharn?').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Sharn is a city.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Tell me about Breland.').length).toBeGreaterThan(0);
    });

    it('renders nothing for assistant mode when no active assistant session exists', () => {
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: undefined, npc: undefined },
        }));

        render(<Assistant />);

        expect(screen.getByText(/select a session or create a new one/i)).toBeTruthy();
        expect(document.getElementById('assistant-feed')).toBeNull();
    });

    it('renders npc cards newest first and marks cards from the active session', () => {
        // API returns NPCs newest-first (by id desc); the component renders them in that order.
        const npcs = [makeNpc(2, 'session-npc-1'), makeNpc(1, 'other-session')];
        mocks.useNpcsQuery.mockReturnValue({ data: { npcs, totalCount: 2, skip: 0, take: 20, filter: '' }, isLoading: false, isPending: false });
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: undefined, npc: makeSessionData('session-npc-1', 'npc') },
        }));

        render(<NpcCards />);

        const activeCard = document.getElementById('npc-card-2');
        const otherCard = document.getElementById('npc-card-1');
        expect(activeCard).not.toBeNull();
        expect(otherCard).not.toBeNull();
        // The in-session card should have an additional CSS class applied.
        expect(activeCard!.className).not.toEqual(otherCard!.className);
    });

    it('shows loading state while npc data is pending', () => {
        mocks.useNpcsQuery.mockReturnValue({ data: undefined, isLoading: true, isPending: true });

        render(<NpcCards />);

        expect(screen.getByText('Loading...')).toBeTruthy();
    });

    it('shows no-npcs message when npc data is loaded but the list is empty', () => {
        mocks.useNpcsQuery.mockReturnValue({ data: { npcs: [], totalCount: 0, skip: 0, take: 20, filter: '' }, isLoading: false, isPending: false });

        render(<NpcCards />);

        expect(screen.getByText('No NPCs found.')).toBeTruthy();
    });

    it('renders a filter input in the npc panel', () => {
        render(<NpcCards />);

        expect(screen.getByRole('textbox')).toBeTruthy();
    });

    it('renders pagination controls when there are more npcs than the page size', () => {
        mocks.useNpcsQuery.mockReturnValue({
            data: { npcs: [makeNpc(1, 'session-1')], totalCount: 25, skip: 0, take: 20, filter: '' },
            isLoading: false,
            isPending: false,
        });

        render(<NpcCards />);

        expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Prev' })).toBeTruthy();
        expect(screen.getByText(/1–20 of 25/)).toBeTruthy();
    });

    it('disables Prev at the first page and Next at the last page', () => {
        mocks.useNpcsQuery.mockReturnValue({
            data: { npcs: [makeNpc(1, 'session-1')], totalCount: 1, skip: 0, take: 20, filter: '' },
            isLoading: false,
            isPending: false,
        });

        render(<NpcCards />);

        expect(screen.getByRole('button', { name: 'Prev' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
    });

    it('disables submit while the session context is busy', () => {
        mocks.useSessionContext.mockReturnValue(makeContext({ isBusy: true }));

        render(<Input />);

        expect(screen.getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(true);
    });

    it('updates prompt retrievalTurnLimit and includePartyContext from input controls', () => {
        const patchActiveTabState = vi.fn();
        mocks.useSessionContext.mockReturnValue(makeContext({ patchActiveTabState }));

        render(<Input />);

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new prompt' } });
        expect(patchActiveTabState).toHaveBeenCalledWith({ prompt: 'new prompt' });

        fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } });
        expect(patchActiveTabState).toHaveBeenCalledWith({ retrievalTurnLimit: 2 });

        // React controlled checkboxes require click (not change) to reliably trigger onChange with the toggled value.
        fireEvent.click(screen.getByRole('checkbox'));
        expect(patchActiveTabState).toHaveBeenCalledWith({ includePartyContext: false });
    });

    it('submits the current tab state through the run hook', async () => {
        const mutateAsync = vi.fn().mockResolvedValue(makeRun('run-1', 'session-1'));
        const patchActiveTabState = vi.fn();
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeTabState: { key: 'assistant' as SessionMode, prompt: 'my question', includePartyContext: true, retrievalTurnLimit: 2 },
            activeSessions: { assistant: makeSessionData('session-1'), npc: undefined },
            patchActiveTabState,
        }));
        mocks.useRunsMutation.mockReturnValue({ mutateAsync });

        render(<Input />);
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
                mode: 'assistant',
                prompt: 'my question',
                includePartyContext: true,
                retrievalTurnLimit: 2,
                sessionId: 'session-1',
            }));
            expect(patchActiveTabState).toHaveBeenCalledWith({ prompt: '' });
        });
    });

    it('renders additional-context loading error saving and saved states', () => {
        // Loading state: spinner text + status label
        mocks.useAdditionalContextQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
        render(<AdditionalContextInput />);
        expect(screen.getByRole('status').textContent).toBe('Loading context');
        expect(screen.getByText('Loading context...')).toBeTruthy();
        cleanup();

        // Error state: error text + status label
        mocks.useAdditionalContextQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
        render(<AdditionalContextInput />);
        expect(screen.getByRole('status').textContent).toBe('Unable to load additional context.');
        expect(screen.getByText('Context unavailable')).toBeTruthy();
        cleanup();

        // Saving state: mutation is pending
        mocks.useAdditionalContextQuery.mockReturnValue({ data: 'some notes', isLoading: false, isError: false });
        mocks.useAdditionalContextMutation.mockReturnValue({ mutate: vi.fn(), isPending: true });
        render(<AdditionalContextInput />);
        expect(screen.getByText('Saving...')).toBeTruthy();
        cleanup();

        // Saved state: defaults — data present, nothing pending
        mocks.useAdditionalContextQuery.mockReturnValue({ data: 'some notes', isLoading: false, isError: false });
        mocks.useAdditionalContextMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
        render(<AdditionalContextInput />);
        expect(screen.getByText('Saved')).toBeTruthy();
    });

    it('renders session options for the selected mode', () => {
        const sessions: SessionDto[] = [
            { id: 's-1', mode: 'assistant', title: 'First Session', runCount: 3, createdAt: '2024-01-01', updatedAt: '2024-01-01', activeRunId: null, includePartyContext: null },
            { id: 's-2', mode: 'assistant', title: 'Second Session', runCount: 7, createdAt: '2024-01-02', updatedAt: '2024-01-02', activeRunId: null, includePartyContext: null },
        ];
        const createTempSession = vi.fn();
        mocks.useSessionContext.mockReturnValue(makeContext({
            sessionsByMode: vi.fn().mockReturnValue(sessions),
            createTempSession,
        }));

        render(<SessionSelector mode='assistant' />);

        expect(screen.getByRole('option', { name: /First Session/ })).toBeTruthy();
        expect(screen.getByRole('option', { name: /Second Session/ })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'New session' }));
        expect(createTempSession).toHaveBeenCalledWith('assistant');
    });

    it('locks include-party-context after the first persisted prompt in a session', () => {
        // Any real (non-temp) session ID means a run has already been committed — lock the checkbox.
        const session = makeSessionData('session-1', 'assistant');
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: session, npc: undefined },
        }));

        render(<Input />);

        expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
    });

    it('promotes a temporary client session to a persisted titled session after the first run', async () => {
        const promoteSession = vi.fn();
        const patchActiveTabState = vi.fn();
        const realRun = makeRun('run-1', 'real-session-id', { sessionId: 'real-session-id' });
        const mutateAsync = vi.fn().mockResolvedValue(realRun);

        mocks.useSessionContext.mockReturnValue(makeContext({
            activeTabState: { key: 'assistant' as SessionMode, prompt: 'test prompt', includePartyContext: false, retrievalTurnLimit: 1 },
            activeSessions: {
                assistant: makeSessionData(TEMP_SESSION_ID, 'assistant'),
                npc: undefined,
            },
            promoteSession,
            patchActiveTabState,
        }));
        mocks.useRunsMutation.mockReturnValue({ mutateAsync });

        render(<Input />);
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
                sessionId: undefined,
            }));
            expect(promoteSession).toHaveBeenCalledWith('assistant', 'real-session-id');
            expect(patchActiveTabState).toHaveBeenCalledWith({ prompt: '' });
        });
    });

    it('smooth-scrolls to the latest assistant exchange when new assistant data arrives', () => {
        const scrollIntoView = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollIntoView;

        const session = makeSessionData('session-1', 'assistant', {
            runs: [makeRun('run-1', 'session-1')],
        });
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: session, npc: undefined },
        }));

        render(<Assistant />);

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('renders visible thinking state during active runs', () => {
        const session = makeSessionData('session-1', 'assistant', { activeRunId: 'run-in-progress' });
        mocks.useSessionContext.mockReturnValue(makeContext({
            activeSessions: { assistant: session, npc: undefined },
        }));

        render(<Assistant />);

        expect(screen.getByText('Thinking…')).toBeTruthy();
    });
});
