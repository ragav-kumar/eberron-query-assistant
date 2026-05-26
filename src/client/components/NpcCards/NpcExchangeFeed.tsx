import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './NpcCards.module.css';
import { useSessionContext } from '../SessionContext/index.js';
import { SessionEntryDto } from '@/dto/index.js';

/**
 * Scrollable exchange feed rendered in the NPC tab's bottom drawer panel.
 * Mirrors the structure of Assistant.tsx but without a table of contents,
 * since NPC sessions tend to be shorter single-purpose exchanges.
 *
 * NPC response entries contain raw XML. The <thinking> block is extracted
 * and rendered with reasoning styling; the <notes> block is rendered with
 * response styling. The <npcs> XML is dropped — it's already rendered as
 * cards in the top panel.
 */
export const NpcExchangeFeed = () => {
    const { activeSessions } = useSessionContext();
    const activeSession = activeSessions.npc;
    const feedRef = useRef<HTMLDivElement>(null);
    const lastRunId = activeSession?.runs.at(-1)?.id;

    useEffect(() => {
        if (!lastRunId || !feedRef.current) return;
        feedRef.current.querySelector(`#npc-run-${lastRunId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [lastRunId]);

    if (activeSession == null || activeSession.runs.length === 0) {
        return <p className={styles.feedEmpty}>No exchanges yet.</p>;
    }

    return (
        <div ref={feedRef} className={styles.feed}>
            {activeSession.runs.map(run => (
                <div key={run.id} id={`npc-run-${run.id}`} className={styles.feedExchange}>
                    {run.sessionEntries.flatMap(entry =>
                        resolveEntryBlocks(entry).map((block, i) => (
                            <div key={`${entry.id}-${i}`} className={styles[`feedEntry-${block.styleKind}`]}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {block.content}
                                </ReactMarkdown>
                            </div>
                        ))
                    )}
                </div>
            ))}
            {activeSession.activeRunId != null && (
                <div className={styles.feedThinking}>Thinking…</div>
            )}
        </div>
    );
};

interface EntryBlock {
    content: string;
    styleKind: 'user' | 'reasoning' | 'response';
}

/**
 * Breaks a session entry into one or more display blocks.
 *
 * Non-response entries map directly to a single block. Response entries
 * contain the full raw model XML, so they are split: any <thinking> block
 * becomes a reasoning-styled block, and the <notes> block becomes the
 * response-styled block. Both may be absent, resulting in an empty array.
 */
const resolveEntryBlocks = (entry: SessionEntryDto): EntryBlock[] => {
    if (entry.kind !== 'response') {
        return entry.content ? [{ content: entry.content, styleKind: entry.kind }] : [];
    }

    const blocks: EntryBlock[] = [];

    const thinking = extractTag(entry.content, 'thinking');
    if (thinking) blocks.push({ content: thinking, styleKind: 'reasoning' });

    const notes = extractTag(entry.content, 'notes');
    if (notes) blocks.push({ content: notes, styleKind: 'response' });

    return blocks;
};

const extractTag = (text: string, tagName: string): string | null => {
    const match = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i').exec(text);
    const content = match?.[1]?.trim();
    return content && content.length > 0 ? content : null;
};
