import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalProps {
    show: boolean;
    children: ReactNode;
    onClickBackground?: () => void;
}

/**
 * Portal-based modal with a dimming overlay and CSS fade transition.
 *
 * Renders into `document.body` so it always escapes parent stacking contexts.
 * The overlay dims the page and intercepts background clicks; clicks on the
 * modal content stop propagation so they do not reach the overlay handler.
 *
 * When `show` becomes false the component stays mounted for 200 ms so the
 * CSS fade-out completes before the DOM node is removed.
 *
 * One animation frame elapses between the overlay mounting and the
 * `data-visible` attribute being set to `true`. This gives the browser a
 * rendered frame with `opacity: 0` so the CSS transition plays on the way in.
 *
 * Background clicks invoke `onClickBackground` when provided; otherwise they
 * call `setShow(false)`.
 */
export const Modal = ({ children, onClickBackground, show }: ModalProps) => {
    const [mounted, setMounted] = useState(show);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setMounted(true);
        } else {
            setVisible(false);
            const timer = setTimeout(() => setMounted(false), 200);
            return () => clearTimeout(timer);
        }
    }, [show]);

    useEffect(() => {
        if (!mounted || !show) return;
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, [mounted, show]);

    if (!mounted) return null;

    return createPortal(
        <div
            className={styles.overlay}
            data-testid='modal-overlay'
            data-visible={visible}
            onClick={onClickBackground}
        >
            <div
                className={styles.modal}
                role='dialog'
                onClick={e => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body
    );
};
