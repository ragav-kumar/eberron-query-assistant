import { useEffect, useRef } from "react";

import type { ApiNpc } from "../api.js";

interface NpcCardsPaneProps {
  npcs: ApiNpc[];
}

/** Renders saved generated NPC cards. */
export const NpcCardsPane = ({ npcs }: NpcCardsPaneProps) => {
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [npcs]);

  return (
    <article className="npc-cards-pane" ref={scrollRef} data-testid="npc-cards-pane">
      {npcs.length > 0 ? (
        <div className="npc-card-grid">
          {npcs.map((npc) => (
            <section className="npc-card" key={npc.id} aria-labelledby={`npc-card-${npc.id}`}>
              <div className="npc-card-header">
                <span className="npc-id">#{npc.id}</span>
                <h2 id={`npc-card-${npc.id}`}>{npc.name}</h2>
              </div>
              <NpcMetadata npc={npc} />
              <p>{npc.description}</p>
              <p>{npc.bio}</p>
            </section>
          ))}
        </div>
      ) : (
        <p className="empty-output">Generate NPCs to save cards here.</p>
      )}
    </article>
  );
};

const NPC_METADATA_FIELDS = [
  ["Species", "species"],
  ["Ethnicity", "ethnicity"],
  ["Gender", "gender"],
  ["Role", "role"],
  ["Age", "age"]
] as const;

const NpcMetadata = ({ npc }: { npc: ApiNpc }) => {
  const details = NPC_METADATA_FIELDS.flatMap(([label, key]) => {
    const value = npc[key];
    return value ? [{ label, value }] : [];
  });

  return details.length > 0 ? (
    <dl className="npc-card-metadata">
      {details.map((detail) => (
        <div className="npc-card-metadata-item" key={detail.label}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
};
