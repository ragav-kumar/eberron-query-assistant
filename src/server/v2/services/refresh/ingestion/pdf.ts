import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PdfData, VerbosityLevel } from 'pdfdataextract';

import type { CorpusChunk, CorpusSource } from '@/types.js';

import type { PdfParser, RefreshRuntimePaths, SourceChangeSet } from '../types.js';
import { chunkText, normalizeText } from './chunking.js';

/**
 * Creates the default PDF parser used by refresh ingestion.
 *
 * The parser is hidden behind a small interface so tests can swap in fixtures
 * without depending on the third-party extraction library.
 */
export const createPdfDataExtractParser = (): PdfParser => ({
    parse: async filePath => {
        const data = await PdfData.extract(await readFile(filePath), {
            get: {
                fingerprint: true,
                info: true,
                metadata: false,
                outline: false,
                pages: true,
                permissions: false,
                text: true,
            },
            sort: true,
            verbosity: VerbosityLevel.ERRORS,
        });

        const text = data.text ?? [];
        return {
            fingerprint: data.fingerprint ?? null,
            pageCount: data.pages ?? text.length,
            pages: text.map((pageText, index) => ({
                pageNumber: index + 1,
                text: normalizeText(pageText),
            })),
            title: typeof data.info?.Title === 'string' && data.info.Title.trim().length > 0 ? data.info.Title.trim() : null,
        };
    },
});

/**
 * Converts discovered PDF additions and removals into corpus source changes.
 */
export const buildPdfSourceChanges = async (
    paths: RefreshRuntimePaths,
    scheduledFilenames: string[],
    removedFilenames: string[],
    parser: PdfParser,
    forceReingest: boolean,
): Promise<SourceChangeSet> => {
    const changes: SourceChangeSet['changes'] = removedFilenames.map(filename => ({
        kind: 'delete' as const,
        sourceKey: filename,
        sourceType: 'pdf' as const,
    }));

    for (const filename of scheduledFilenames) {
        const normalized = await normalizePdf(paths, filename, parser);
        changes.push({
            kind: 'upsert',
            chunks: normalized.chunks,
            source: normalized.source,
        });
    }

    return {
        ...(forceReingest ? { clearSourceType: 'pdf' as const } : {}),
        changes,
    };
};

/**
 * Normalizes one PDF into a single corpus source plus per-page text chunks.
 */
const normalizePdf = async (
    paths: RefreshRuntimePaths,
    filename: string,
    parser: PdfParser,
): Promise<{ chunks: CorpusChunk[]; source: CorpusSource }> => {
    const filePath = path.join(paths.pdfDir, filename);
    const parsed = await parser.parse(filePath);
    const title = parsed.title ?? friendlyTitle(filename);
    const sourceKey = filename;
    const sourceId = `pdf:${hashText(sourceKey)}`;

    const source: CorpusSource = {
        metadata: {
            filename,
            fingerprint: parsed.fingerprint,
            pageCount: parsed.pageCount,
            sourceType: 'pdf',
            title,
        },
        sourceId,
        sourceKey,
        sourceType: 'pdf',
        status: 'succeeded',
        title,
    };

    const chunks: CorpusChunk[] = [];
    for (const page of parsed.pages) {
        for (const chunk of chunkText(page.text)) {
            if (chunk.text.length === 0) {
                continue;
            }

            const chunkIndex = chunks.length;
            chunks.push({
                chunkId: `${sourceId}:chunk:${chunkIndex}`,
                chunkIndex,
                citation: {
                    label: title,
                    locator: `page ${page.pageNumber}`,
                    sourceType: 'pdf',
                    url: null,
                },
                metadata: {
                    endParagraph: chunk.endParagraph,
                    filename,
                    pageNumber: page.pageNumber,
                    sourceType: 'pdf',
                    startParagraph: chunk.startParagraph,
                },
                sourceId,
                text: chunk.text,
            });
        }
    }

    return { chunks, source };
};

const friendlyTitle = (filename: string): string => path
    .basename(filename, path.extname(filename))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 24);
