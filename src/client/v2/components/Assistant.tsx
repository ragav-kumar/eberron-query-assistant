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
            {activeSession.exchanges.map(exchange => (
                <div id={`exchange-${exchange.id}`} className={styles.exchange}>
                    {exchange.entries.map(entry => (
                        <div id={`exchange-${exchange.id}-entry-${entry.id}`} className={styles[`entry-${entry.kind}`]}>
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