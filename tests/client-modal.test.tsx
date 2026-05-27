// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@client/components/Modal.js';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('Modal', () => {
    it('renders children when show is true', () => {
        render(
            <Modal show>
                <p>Modal content</p>
            </Modal>
        );
        expect(screen.getByText('Modal content')).toBeTruthy();
    });

    it('renders nothing when show is false', () => {
        render(
            <Modal show={false}>
                <p>Hidden content</p>
            </Modal>
        );
        expect(screen.queryByText('Hidden content')).toBeNull();
    });

    it('calls onClickBackground when the overlay background is clicked', () => {
        const onClickBackground = vi.fn();
        render(
            <Modal show onClickBackground={onClickBackground}>
                <p>Content</p>
            </Modal>
        );
        fireEvent.click(screen.getByTestId('modal-overlay'));
        expect(onClickBackground).toHaveBeenCalled();
    });

    it('does not call onClickBackground when modal content is clicked', () => {
        const onClickBackground = vi.fn();
        render(
            <Modal show onClickBackground={onClickBackground}>
                <p>Content</p>
            </Modal>
        );
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClickBackground).not.toHaveBeenCalled();
    });

    it('unmounts after the fade-out delay when show becomes false', () => {
        vi.useFakeTimers();
        const { rerender } = render(
            <Modal show>
                <p>Content</p>
            </Modal>
        );
        expect(screen.getByText('Content')).toBeTruthy();

        rerender(
            <Modal show={false}>
                <p>Content</p>
            </Modal>
        );
        // Still mounted briefly so the CSS fade-out can complete.
        expect(screen.queryByText('Content')).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(screen.queryByText('Content')).toBeNull();
    });
});
