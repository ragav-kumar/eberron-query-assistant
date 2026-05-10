import styles from './Console.module.css';
import { useConsoleQuery } from '../api/index.js';
import { joinClassNames } from '@/client/v2/utils.js';

export const Console = () => {
    const query = useConsoleQuery();

    return (
        <footer className={styles.wrap} data-testid='console-feed'>
            {query.isLoading ? (
                <p className={styles.empty}>Loading...</p>
            ) : !query.data?.length ? (
                <p className={styles.empty}>No local console output yet.</p>
            ) : query.data.map(entry => (
                <div className={styles.entry} key={entry.id}>
                    <span className={styles.timestamp}>{formatTimestamp(entry.timestamp)}</span>
                    <span className={joinClassNames(styles.level, styles[entry.level])}>{entry.level.toUpperCase()}</span>
                    <span className={styles.message}>{entry.message}</span>
                </div>
            ))}
        </footer>
    );
};

const formatTimestamp = (timestamp: string): string => (
    timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp
);
