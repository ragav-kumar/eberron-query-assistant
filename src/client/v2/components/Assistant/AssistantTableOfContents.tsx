import type { RunDto, SessionEntryResponseDto } from '@/dto/index.js';
import styles from './Assistant.module.css';

interface AssistantTableOfContentsProps {
    runs: RunDto[];
}

/**
 * Truncates a string to `max` characters, appending an ellipsis if cut.
 */
const truncate = (text: string, max = 65): string =>
    text.length <= max ? text : text.slice(0, max).trimEnd() + '…';

/**
 * Returns a display label for a TOC entry.
 * - Active runs (pending/running) get a fixed in-progress label.
 * - Completed runs prefer the model-supplied response title.
 * - Falls back to the truncated user prompt, then a positional label.
 */
const getRunLabel = (run: RunDto, index: number): string => {
    if (run.status === 'pending' || run.status === 'running') {
        return 'Response in progress…';
    }
    const responseEntry = run.sessionEntries.find((e): e is SessionEntryResponseDto => e.kind === 'response');
    if (responseEntry?.title) return responseEntry.title;
    const userEntry = run.sessionEntries.find(e => e.kind === 'user');
    return userEntry ? truncate(userEntry.content) : `Exchange ${index + 1}`;
};

/**
 * Sticky table of contents for the assistant feed. Sticks to the top of the
 * scrollable feed container and reveals a floating exchange list on hover.
 * Panel visibility and chevron direction are driven entirely by CSS :hover.
 *
 * Renders nothing when there is only one run — a single-entry TOC adds no value.
 */
export const AssistantTableOfContents = ({ runs }: AssistantTableOfContentsProps) => {
    if (runs.length < 2) return null;

    const scrollToRun = (runId: string) => {
        document.getElementById(`run-${runId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className={styles.toc}>
            <div className={styles.tocToggle}>
                <span>{runs.length} exchanges</span>
                <span className={styles.tocChevron} />
            </div>
            <nav className={styles.tocPanel} aria-label='Session exchanges'>
                <ol className={styles.list}>
                    {runs.map((run, index) => (
                        <li key={run.id} className={styles.item}>
                            <button className={styles.link} onClick={() => scrollToRun(run.id)}>
                                <span className={styles.index}>{index + 1}.</span>
                                <span className={styles.label}>{getRunLabel(run, index)}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            </nav>
        </div>
    );
};
