import { useRefreshMutation, useRefreshQuery } from '@/client/api/index.js';
import type { RefreshDto } from '@/dto/index.js';
import { Button } from './Button.js';
import styles from './LeftColumnHeader.module.css';

export const LeftColumnHeader = () => {
    const query = useRefreshQuery();
    const mutation = useRefreshMutation();

    const refresh = mutation.data ?? query.data;
    const isRefreshActive = mutation.isPending || refresh?.activeOperation != null;

    const onRefresh = (kind: 'refresh' | 'reingest') => {
        if (kind === 'reingest') {
            const confirmed = window.confirm('Force reingest destroys and rebuilds app-owned corpus and retrieval artifacts. Continue?');
            if (!confirmed) {
                return;
            }
        }

        mutation.mutate({ kind });
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
                    onClick={() => onRefresh('refresh')}
                    title='Check sources and update retrieval artifacts only where needed.'
                    variant='primary'
                >
                    Refresh
                </Button>
                <Button
                    disabled={isRefreshActive && refresh?.activeOperation === 'reingest'}
                    onClick={() => onRefresh('reingest')}
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
    refresh: RefreshDto | undefined,
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

    if (
        refresh.activeOperation === 'reingest'
        || refresh.reingestStatus === 'pending'
        || refresh.reingestStatus === 'running'
    ) {
        return 'Rebuilding app-owned corpus and retrieval artifacts.';
    }

    if (
        refresh.activeOperation === 'refresh'
        || refresh.refreshStatus === 'pending'
        || refresh.refreshStatus === 'running'
    ) {
        return 'Checking sources and refresh state.';
    }

    if (refresh.reingestStatus === 'failed') {
        return `Last force reingest failed at ${formatTimestamp(refresh.updatedAt)}.`;
    }

    if (refresh.refreshStatus === 'failed') {
        return `Last refresh failed at ${formatTimestamp(refresh.updatedAt)}.`;
    }

    const latestOperation = getLatestCompletedOperation(refresh);
    const updatedAt = latestOperation === 'refresh' ? refresh.lastRefreshAt : refresh.lastReingestAt;
    return `Last ${latestOperation} completed at ${formatTimestamp(updatedAt)}.`;
};

const getLatestCompletedOperation = (refresh: RefreshDto): 'refresh' | 'force reingest' => {
    const lastRefreshAt = parseTimestamp(refresh.lastRefreshAt);
    const lastReingestAt = parseTimestamp(refresh.lastReingestAt);

    if (lastReingestAt > lastRefreshAt) {
        return 'force reingest';
    }

    return 'refresh';
};

const parseTimestamp = (timestamp: string | null): number => {
    if (timestamp == null) {
        return Number.NEGATIVE_INFINITY;
    }

    const parsed = new Date(timestamp).valueOf();
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

const formatTimestamp = (timestamp: string | null): string => {
    if (timestamp == null) {
        return 'Never';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) {
        return timestamp;
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
};
