// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeftColumnHeader } from '@/client/v2/components/LeftColumnHeader.js';

const { useRefreshMutation, useRefreshQuery } = vi.hoisted(() => ({
    useRefreshMutation: vi.fn(),
    useRefreshQuery: vi.fn(),
}));

vi.mock('@/client/v2/api/index.js', () => ({
    useRefreshQuery,
    useRefreshMutation,
}));

describe('v2 left column header', () => {
    const mutate = vi.fn();

    beforeEach(() => {
        useRefreshQuery.mockReturnValue({
            data: {
                activeOperation: null,
                lastRefreshAt: '2026-05-08T17:49:08.127Z',
                lastReingestAt: null,
                refreshStatus: 'completed',
                reingestStatus: 'idle',
                createdAt: '2026-05-08T17:49:05.654Z',
                updatedAt: '2026-05-08T17:49:08.127Z',
            },
            isError: false,
            isLoading: false,
        });

        useRefreshMutation.mockReturnValue({
            data: undefined,
            isPending: false,
            mutate,
        });
    });

    afterEach(() => {
        cleanup();
        mutate.mockReset();
        vi.restoreAllMocks();
    });

    it('renders the latest refresh status and starts a routine refresh', () => {
        render(<LeftColumnHeader />);

        const heading = screen.getByRole('heading', { name: 'Eberron Query Assistant' });
        const status = screen.getByText(/Last refresh completed at/i);

        expect(heading.textContent).toBe('Eberron Query Assistant');
        expect(status.textContent).toMatch(/^Last refresh completed at /);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

        expect(mutate).toHaveBeenCalledWith({ kind: 'refresh' });
    });

    it('confirms before force reingest and respects cancellation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        render(<LeftColumnHeader />);

        fireEvent.click(screen.getByRole('button', { name: 'Force reingest' }));

        expect(confirmSpy).toHaveBeenCalledWith(
            'Force reingest clears and rebuilds app-owned corpus and retrieval artifacts. Continue?',
        );
        expect(mutate).not.toHaveBeenCalled();
    });

    it('disables refresh controls while refresh is active', () => {
        // Transitional note: the refresh DTO no longer exposes a single status/forceReingest pair.
        useRefreshQuery.mockReturnValue({
            data: {
                activeOperation: 'reingest',
                lastRefreshAt: '2026-05-08T17:49:08.127Z',
                lastReingestAt: null,
                refreshStatus: 'completed',
                reingestStatus: 'running',
                createdAt: '2026-05-08T17:49:05.654Z',
                updatedAt: '2026-05-08T17:49:08.127Z',
            },
            isError: false,
            isLoading: false,
        });

        render(<LeftColumnHeader />);

        const status = screen.getByText('Rebuilding app-owned corpus and retrieval artifacts.');
        const refreshButton = screen.getByRole('button', { name: 'Refresh' });
        const forceButton = screen.getByRole('button', { name: 'Force reingest' });

        expect(status.textContent).toBe('Rebuilding app-owned corpus and retrieval artifacts.');
        expect(refreshButton.getAttribute('disabled')).not.toBeNull();
        expect(forceButton.getAttribute('disabled')).not.toBeNull();
    });
});
