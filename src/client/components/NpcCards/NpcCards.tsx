import { useState } from 'react';
import styles from './NpcCards.module.css';
import { NpcCard } from './NpcCard.js';
import { useSessionContext } from '../SessionContext/index.js';
import { useNpcsQuery } from '@/client/api/index.js';

const TAKE = 20;

/**
 * Renders all persisted NPC cards with server-side filtering and pagination.
 * Cards from the currently active NPC session are visually distinguished via
 * the isInSession prop. The full response XML is stored per run so the model
 * can reconstruct NPC history on subsequent exchanges within the same session.
 */
export const NpcCards = () => {
    const { activeSessions } = useSessionContext();
    const activeSessionId = activeSessions.npc?.id;

    const [filter, setFilter] = useState('');
    const [skip, setSkip] = useState(0);

    const queryParams = {
        ...(filter.trim() ? { filter: filter.trim() } : {}),
        ...(skip > 0 ? { skip: String(skip) } : {}),
        take: String(TAKE),
    };
    const npcQuery = useNpcsQuery(queryParams);
    const totalCount = npcQuery.data?.totalCount ?? 0;

    const handleFilterChange = (value: string) => {
        setFilter(value);
        setSkip(0);
    };

    const canGoPrev = skip > 0;
    const canGoNext = skip + TAKE < totalCount;

    return (
        <div className={styles.container}>
            <input
                className={styles.filterInput}
                type='text'
                placeholder='Filter by name…'
                value={filter}
                onChange={e => handleFilterChange(e.target.value)}
            />

            {npcQuery.isLoading || npcQuery.isPending ? (
                <p className={styles.empty}>Loading...</p>
            ) : !npcQuery.data?.npcs.length ? (
                <p className={styles.empty}>No NPCs found.</p>
            ) : (
                <div className={styles.grid}>
                    {npcQuery.data.npcs.map(npc => (
                        <NpcCard
                            key={npc.id}
                            npc={npc}
                            isInSession={activeSessionId === npc.sessionId}
                        />
                    ))}
                </div>
            )}

            {totalCount > 0 && (
                <div className={styles.pagination}>
                    <span className={styles.paginationInfo}>
                        {Math.min(skip + 1, totalCount)}–{Math.min(skip + TAKE, totalCount)} of {totalCount}
                    </span>
                    <button
                        className={styles.paginationButton}
                        disabled={!canGoPrev}
                        onClick={() => setSkip(Math.max(0, skip - TAKE))}
                    >
                        Prev
                    </button>
                    <button
                        className={styles.paginationButton}
                        disabled={!canGoNext}
                        onClick={() => setSkip(skip + TAKE)}
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
};
