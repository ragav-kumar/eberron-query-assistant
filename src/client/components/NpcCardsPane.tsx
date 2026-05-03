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
