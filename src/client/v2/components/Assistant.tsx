import styles from './Assistant.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSessionContext } from './SessionContext/index.js';

export const Assistant = () => {
    const { activeSessions } = useSessionContext();
    const activeSession = activeSessions.assistant;

    if (activeSession == null) {
        // TODO: Replace with empty session output
        return null;
    }
    return (
        <div id='assistant-feed' className={styles.wrap}>
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
        </div>
    );
};
