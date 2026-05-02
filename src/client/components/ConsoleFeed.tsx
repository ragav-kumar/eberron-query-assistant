import { useEffect, useRef } from "react";

import type { ApiConsoleEntry } from "../api.js";

interface ConsoleFeedProps {
  entries: ApiConsoleEntry[];
}

/** Renders transient local operation messages as a console-style feed. */
export const ConsoleFeed = ({ entries }: ConsoleFeedProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="console-feed" ref={scrollRef} data-testid="console-feed">
      {entries.length > 0 ? (
        entries.map((entry) => (
          <div className={`console-entry ${entry.level}`} key={entry.id}>
            <span className="console-time">{formatTimestamp(entry.timestamp)}</span>
            <span className="console-level">{entry.level.toUpperCase()}</span>
            <span className="console-message">{entry.message}</span>
          </div>
        ))
      ) : (
        <p className="empty-output">No local console output yet.</p>
      )}
    </div>
  );
};

const formatTimestamp = (timestamp: string): string => {
  return timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp;
};
