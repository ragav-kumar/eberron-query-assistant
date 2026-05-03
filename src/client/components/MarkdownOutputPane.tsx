import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ApiLogExchange } from "../api.js";

interface MarkdownOutputPaneProps {
  emptyMessage: string;
  exchanges: ApiLogExchange[];
}

/** Renders structured assistant transcript logs and keeps the latest output in view. */
export const MarkdownOutputPane = ({ emptyMessage, exchanges }: MarkdownOutputPaneProps) => {
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [exchanges]);

  return (
    <article className="markdown-output" ref={scrollRef} data-testid="markdown-output">
      {exchanges.length > 0 ? (
        <>
          <nav className="log-toc" aria-label="Log table of contents">
            <h2>Contents</h2>
            <ol>
              {exchanges.map((exchange, index) => (
                <li key={`toc-${index}`}>
                  <a href={`#log-exchange-${index + 1}`}>{exchange.title}</a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="log-exchanges">
            {exchanges.map((exchange, index) => (
              <section
                className="log-exchange"
                id={`log-exchange-${index + 1}`}
                key={`exchange-${index}`}
              >
                <h2>{exchange.title}</h2>
                <div className="log-question">
                  <h3>User</h3>
                  <p>{exchange.user}</p>
                </div>
                <div className="log-answer">
                  <h3>Assistant</h3>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{exchange.assistant}</ReactMarkdown>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-output">{emptyMessage}</p>
      )}
    </article>
  );
};
