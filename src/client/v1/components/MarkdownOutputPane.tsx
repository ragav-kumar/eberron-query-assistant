import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ApiLogEntry } from '../api.js';

interface MarkdownOutputPaneProps {
  emptyMessage: string;
  exchanges: ApiLogEntry[];
}

/** Renders structured assistant transcript logs and keeps the latest output in view. */
export const MarkdownOutputPane = ({ emptyMessage, exchanges }: MarkdownOutputPaneProps) => {
  const scrollRef = useRef<HTMLElement>(null);
  const tocEntries = exchanges.flatMap((entry, index) => entry.kind === 'exchange'
    ? [{ index, title: entry.title }]
    : []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [exchanges]);

  return (
    <article className='markdown-output' ref={scrollRef} data-testid='markdown-output'>
      {exchanges.length > 0 ? (
        <>
          {tocEntries.length > 0 ? (
            <nav className='log-toc' aria-label='Log table of contents'>
              <h2>Contents</h2>
              <ol>
                {tocEntries.map((entry) => (
                  <li key={`toc-${entry.index}`}>
                    <a href={`#log-exchange-${entry.index + 1}`}>{entry.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className='log-exchanges'>
            {exchanges.map((entry, index) => entry.kind === 'exchange' ? (
              <section
                  className='log-exchange'
                  id={`log-exchange-${index + 1}`}
                  key={`exchange-${index}`}
              >
                <h2>{entry.title}</h2>
                <div className='log-question'>
                  <h3>User</h3>
                  <p>{entry.user}</p>
                </div>
                <div className='log-answer'>
                  <h3>Assistant</h3>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.assistant}</ReactMarkdown>
                </div>
              </section>
            ) : (
              <section className='log-progress' key={`progress-${index}`}>
                <h2>Progress</h2>
                <p>{entry.message}</p>
              </section>
            ))}
          </div>
        </>
      ) : (
        <p className='empty-output'>{emptyMessage}</p>
      )}
    </article>
  );
};
