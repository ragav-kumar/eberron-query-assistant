import styles from './Assistant.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef } from 'react';
import { useSessionContext } from './SessionContext/index.js';

export const Assistant = () => {
    const { activeSessions } = useSessionContext();
    const activeSession = activeSessions.assistant;
    const feedRef = useRef<HTMLDivElement>(null);
    const lastRunId = activeSession?.runs.at(-1)?.id;

    // Scroll to the start of the newest run whenever the active run changes.
    useEffect(() => {
        if (!lastRunId || !feedRef.current) return;
        feedRef.current.querySelector(`#run-${lastRunId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [lastRunId]);

    if (activeSession == null) {
        return (
            <p className={styles.empty}>Select a session or create a new one to get started.</p>
        );
    }

    return (
        <div ref={feedRef} id='assistant-feed' className={styles.wrap}>
            {activeSession.runs.map(run => (
                <div key={run.id} id={`run-${run.id}`} className={styles.exchange}>
                    {run.sessionEntries.map(entry => (
                        <div key={entry.id} id={`run-${run.id}-entry-${entry.id}`} className={styles[`entry-${entry.kind}`]}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {entry.content}
                            </ReactMarkdown>
                        </div>
                    ))}
                </div>
            ))}
            {activeSession.activeRunId != null && (
                <div className={styles.thinking}>Thinking…</div>
            )}
        </div>
    );
};
