import styles from './NpcCards.module.css';
import { NpcCard } from './NpcCard.js';
import { useSessionContext } from '../SessionContext/index.js';
import { useNpcsQuery } from '@/client/v2/api/index.js';

export const NpcCards = () => {
    const { activeSessions } = useSessionContext();
    const activeSessionId = activeSessions.npc?.id;
    const npcQuery = useNpcsQuery();

    if (npcQuery.isLoading || npcQuery.isPending || !npcQuery.data?.npcs.length) {
        return (
            <p className={styles.empty}>
                Loading...
            </p>
        );
    }

    return (
        <div className={styles.grid}>
            {npcQuery.data?.npcs.map(npc => (
                <NpcCard
                    key={npc.id}
                    npc={npc}
                    isInSession={activeSessionId === npc.sessionId}
                />
            ))}
        </div>
    );
};
