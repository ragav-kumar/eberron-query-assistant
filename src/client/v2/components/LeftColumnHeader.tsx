import { useRefreshMutation, useRefreshQuery } from '@/client/v2/api/index.js';
import type { Refresh } from '@/dto/index.js';
import { Button } from './Button.js';
import styles from './LeftColumnHeader.module.css';

export const LeftColumnHeader = () => {
    const query = useRefreshQuery();
    const mutation = useRefreshMutation();

    const refresh = mutation.data ?? query.data;
    const isRefreshActive = mutation.isPending || refresh?.status === 'pending' || refresh?.status === 'running';

    const onRefresh = (forceReingest: boolean) => {
        if (forceReingest) {
            const confirmed = window.confirm('Force reingest clears and rebuilds app-owned corpus and retrieval artifacts. Continue?');
            if (!confirmed) {
                return;
            }
        }

        mutation.mutate({ forceReingest });
    };

    return (
        <header className={styles.header}>
            <div className={styles.titleBlock}>
                <h1 className={styles.title}>Eberron Query Assistant</h1>
                <p className={styles.status}>{renderRefreshStatus(query, refresh)}</p>
            </div>
            <div className={styles.actions}>
                <Button
                    disabled={isRefreshActive}
                    onClick={() => onRefresh(false)}
                    title='Check sources and update retrieval artifacts only where needed.'
                    variant='primary'
                >
                    Refresh
                </Button>
                <Button
                    disabled={isRefreshActive}
                    onClick={() => onRefresh(true)}
                    title='Clear and rebuild app-owned corpus and retrieval artifacts.'
                    variant='danger'
                >
                    Force reingest
                </Button>
            </div>
        </header>
    );
};

const renderRefreshStatus = (
    query: ReturnType<typeof useRefreshQuery>,
    refresh: Refresh | undefined,
): string => {
    if (query.isLoading && refresh == null) {
        return 'Loading refresh status...';
    }

    if (query.isError && refresh == null) {
        return 'Refresh status unavailable.';
    }

    if (refresh == null) {
        return 'No refresh state available yet.';
    }

    if (refresh.status === 'pending' || refresh.status === 'running') {
        return refresh.forceReingest ? 'Rebuilding app-owned corpus and retrieval artifacts.' : 'Checking sources and refresh state.';
    }

    if (refresh.status === 'failed') {
        return `Last ${refresh.forceReingest ? 'force reingest' : 'refresh'} failed at ${formatTimestamp(refresh.updatedAt)}.`;
    }

    return `Last ${refresh.forceReingest ? 'force reingest' : 'refresh'} completed at ${formatTimestamp(refresh.updatedAt)}.`;
};

const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) {
        return timestamp;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
};
