import styles from './NpcCards.module.css';
import { NpcCard } from './NpcCard.js';
import { useSessionContext } from '../SessionContext/index.js';

export const NpcCards = () => {
    const { activeSession } = useSessionContext();

    if (activeSession?.mode !== 'npc') {
        // TODO: Replace with empty session output
        return null;
    }

    if (activeSession.npcs.length === 0) {
        return (
            <p className={styles.empty}>
                Generate NPCs to save cards here.
            </p>
        );
    }

    return (
        <div className={styles.grid}>
            {activeSession.npcs.map(npc => (
                <NpcCard key={npc.id} npc={npc}/>
            ))}
        </div>
    );
};
