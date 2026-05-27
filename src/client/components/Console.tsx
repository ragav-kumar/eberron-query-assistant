import { useEffect, useRef } from 'react';

import styles from './Console.module.css';
import { useConsoleEntries } from '../api/index.js';
import { joinClassNames } from '@/client/utils.js';

export const Console = () => {
    const consoleLines = useConsoleEntries();
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView();
    }, [consoleLines]);

    return (
        <footer className={styles.wrap} data-testid='console-feed'>
            {!consoleLines.length ? (
                <p className={styles.empty}>No local console output yet.</p>
            ) : consoleLines.map(entry => (
                <div className={styles.entry} key={entry.id}>
                    <span className={styles.timestamp}>{formatTimestamp(entry.timestamp)}</span>
                    <span className={joinClassNames(styles.level, styles[entry.level])}>{entry.level.toUpperCase()}</span>
                    <span className={styles.message}>{entry.message}</span>
                </div>
            ))}
            <div ref={bottomRef} />
        </footer>
    );
};

const formatTimestamp = (timestamp: string): string => (
    timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp
);
