import { readdir } from 'node:fs/promises';

import { hasErrorCode } from '@/errors.js';

import type { PdfDiscoveryResult } from '../types.js';

export const discoverPdfRefresh = async (
    pdfDir: string,
    knownFilenames: string[],
    forceReingest: boolean,
): Promise<PdfDiscoveryResult> => {
    let currentFilenames: string[];

    try {
        const entries = await readdir(pdfDir, { withFileTypes: true });
        currentFilenames = entries
            .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
            .map(entry => entry.name)
            .sort((left, right) => left.localeCompare(right));
    } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
            throw error;
        }

        currentFilenames = [];
    }

    const previous = new Set(knownFilenames);
    const current = new Set(currentFilenames);
    const added = currentFilenames.filter(filename => !previous.has(filename));
    const removed = knownFilenames.filter(filename => !current.has(filename));

    return {
        currentFilenames,
        removedFilenames: forceReingest ? [] : removed,
        scheduledFilenames: forceReingest ? currentFilenames : added,
    };
};
