import { NpcDto } from '@/dto/index.js';
import { getSpeciesIcon } from './speciesIconLookup.js';
import styles from './NpcCards.module.css';
import { joinClassNames } from '@/client/v2/utils.js';

interface NpcCardProps {
    npc: NpcDto;
    isInSession: boolean;
}

const npcMetadataFields = [
    ['Species', 'species'],
    ['Ethnicity', 'ethnicity'],
    ['Gender', 'gender'],
    ['Role', 'role'],
    ['Age', 'age'],
] as const satisfies ReadonlyArray<readonly [label: string, key: keyof NpcDto]>;

export const NpcCard = ({npc, isInSession}: NpcCardProps) => {
    const speciesIcon = getSpeciesIcon(npc.species);
    const metadata = npcMetadataFields.flatMap(([label, key]) => {
        const value = npc[key];
        return value ? [{label, value}] : [];
    });

    return (
        <article
            id={`npc-card-${npc.id}`}
            className={joinClassNames(styles.wrap, isInSession ? styles.inSession : null)}
        >
            <header className={styles.header}>
                <span className={styles.id}>
                        #{npc.id}
                    </span>
                <h2 className={styles.name}>
                    {npc.name}
                </h2>
                {speciesIcon ? (
                    <img
                        className={styles.icon}
                        src={speciesIcon}
                        alt={npc.species ? `${npc.species} icon` : 'Species icon'}
                    />
                ) : <div />}
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
