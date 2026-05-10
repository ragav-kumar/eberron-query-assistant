import styles from './Console.module.css';
import { useConsoleQuery } from '../../api/index.js';

export const Console = () => {
    const query = useConsoleQuery();

    return (
        <footer className={styles.wrap}>
            {query.isLoading ? (
                <p>Loading...</p>
            ) : !query.data?.length ? (
                <p>No records.</p>
            ) : query.data.map(entry => (
                <div className={styles.entry} key={entry.id}>
                    <span>{entry.timestamp}</span>
                    <span>{entry.level.toUpperCase()}</span>
                    <span>{entry.message}</span>
                </div>
            ))}
        </footer>
    );
};