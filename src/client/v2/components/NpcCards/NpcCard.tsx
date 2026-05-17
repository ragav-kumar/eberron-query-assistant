import { Npc } from '@/dto/index.js';
import { getSpeciesIcon } from './speciesIconLookup.js';
import styles from './NpcCards.module.css';

interface NpcCardProps {
    npc: Npc;
}

const npcMetadataFields = [
    ['Species', 'species'],
    ['Ethnicity', 'ethnicity'],
    ['Gender', 'gender'],
    ['Role', 'role'],
    ['Age', 'age'],
] as const satisfies ReadonlyArray<readonly [label: string, key: keyof Npc]>;

export const NpcCard = ({npc}: NpcCardProps) => {
    const speciesIcon = getSpeciesIcon(npc.species);
    const metadata = npcMetadataFields.flatMap(([label, key]) => {
        const value = npc[key];
        return value ? [{label, value}] : [];
    });

    return (
        <article className={styles.wrap} aria-labelledby={`npc-card-${npc.id}`}>
            <header className={styles.header}>
                <div className={styles.headerText}>
                    <span className={styles.id}>#{npc.id}</span>
                    <h2 id={`npc-card-${npc.id}`} className={styles.name}>{npc.name}</h2>
                </div>
                {speciesIcon ? (
                    <img
                        className={styles.icon}
                        src={speciesIcon}
                        alt={npc.species ? `${npc.species} icon` : 'Species icon'}
                    />
                ) : null}
            </header>
            {metadata.length > 0 ? (
                <dl className={styles.metadata}>
                    {metadata.map(detail => (
                        <div className={styles.metadataItem} key={detail.label}>
                            <dt>{detail.label}</dt>
                            <dd>{detail.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            <div className={styles.body}>
                <p>{npc.description}</p>
                <p>{npc.bio}</p>
            </div>
        </article>
    );
};
