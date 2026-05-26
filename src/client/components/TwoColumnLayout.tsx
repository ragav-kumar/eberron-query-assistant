import { useEffect, useRef, useState, ReactNode } from 'react';
import { Group, Panel, Separator, PanelImperativeHandle } from 'react-resizable-panels';
import styles from './TwoColumnLayout.module.css';

/**
 * Each NPC card: 28rem content-box flex-basis + 0.9rem padding × 2 sides = 29.8rem outer width.
 * No box-sizing: border-box on cards, so padding adds to flex-basis.
 */
const CARD_OUTER_REM = 29 + 0.9 * 2;

/**
 * Minimum right-pane width in rem for 2 NPC cards per row:
 * 2 × card outer rem + 1 × 0.85rem gap + 2 × 1rem tab-content padding.
 * Fixed pixel overhead (borders + scrollbar) is added separately in computeRightSize.
 */
const TWO_CARD_MIN_REM = 2 * CARD_OUTER_REM + 0.85 + 2;

/** 1px border × 2 sides × 2 cards = 4px total fixed pixel overhead. */
const TWO_CARD_BORDER_PX = 4;

let scrollbarWidthCache: number | null = null;

/** Measures the classic scrollbar width once and caches it; returns 0 on overlay-scrollbar platforms. */
const getScrollbarWidth = (): number => {
    if (scrollbarWidthCache !== null) return scrollbarWidthCache;
    const div = document.createElement('div');
    div.style.cssText = 'overflow:scroll;position:absolute;top:-9999px;width:50px;height:50px';
    document.body.appendChild(div);
    scrollbarWidthCache = div.offsetWidth - div.clientWidth;
    document.body.removeChild(div);
    return scrollbarWidthCache;
};

const computeRightSize = (minPct: number, maxPct: number): number => {
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const viewportWidth = window.innerWidth;
    if (!viewportWidth) return maxPct;
    const minPx = TWO_CARD_MIN_REM * remPx + TWO_CARD_BORDER_PX + getScrollbarWidth();
    return Math.max(minPct, Math.min(maxPct, (minPx / viewportWidth) * 100));
};

/**
 * Returns the smallest right-panel percentage in [minPct, maxPct] whose pixel
 * width fits two NPC cards per row in the tab content area. Recomputes on every
 * window resize so the optimal split is always applied.
 */
const useOptimalRightSize = (minPct: number, maxPct: number): number => {
    const [size, setSize] = useState(() => computeRightSize(minPct, maxPct));
    useEffect(() => {
        const onResize = () => setSize(computeRightSize(minPct, maxPct));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [minPct, maxPct]);
    return size;
};

interface TwoColumnLayoutProps {
    children: [ReactNode, ReactNode];
}

/**
 * Horizontal two-column splitter. The right panel defaults to the smallest
 * percentage in [50%, 70%] that fits two NPC cards side by side, and tracks
 * the optimal split on every window resize via the imperative panel API.
 */
export const TwoColumnLayout = ({ children: [left, right] }: TwoColumnLayoutProps) => {
    const rightSize = useOptimalRightSize(50, 70);
    const rightPanelRef = useRef<PanelImperativeHandle | null>(null);

    useEffect(() => {
        rightPanelRef.current?.resize(`${rightSize}%`);
    }, [rightSize]);

    return (
        <Group orientation='horizontal'>
            <Panel defaultSize={`${100 - rightSize}%`} minSize='200px'>
                {left}
            </Panel>
            <Separator className={styles.handle} aria-label='Resize columns' />
            <Panel defaultSize={`${rightSize}%`} minSize='200px' panelRef={rightPanelRef}>
                {right}
            </Panel>
        </Group>
    );
};
