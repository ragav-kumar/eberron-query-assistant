import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownOutputPaneProps {
  emptyMessage: string;
  markdown: string;
}

/** Renders persisted assistant transcript Markdown and keeps the latest output in view. */
export const MarkdownOutputPane = ({ emptyMessage, markdown }: MarkdownOutputPaneProps) => {
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [markdown]);

  return (
    <article className="markdown-output" ref={scrollRef} data-testid="markdown-output">
      {markdown.length > 0 ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : (
        <p className="empty-output">{emptyMessage}</p>
      )}
    </article>
  );
};
