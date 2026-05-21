import { fs, vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => fs.promises);

// Sanitized sample suite: keep this as a unit-test pattern for repo file behavior with a virtual filesystem.
describe('refresh file discovery', () => {
    beforeEach(() => {
        vol.reset();
    });

    afterEach(() => {
        vol.reset();
        vi.resetModules();
    });

    it('discovers added and removed PDF files from the current inventory', async () => {
        vol.fromJSON({
            '/repo/pdf/eberron.pdf': 'pdf bytes',
            '/repo/pdf/sharn.PDF': 'pdf bytes',
            '/repo/pdf/readme.txt': 'not a pdf',
        });

        const { discoverPdfRefresh } = await import('@server/services/refresh/discovery/pdf.js');
        const result = await discoverPdfRefresh('/repo/pdf', ['old.pdf', 'sharn.PDF'], false);

        expect(result).toEqual({
            currentFilenames: ['eberron.pdf', 'sharn.PDF'],
            removedFilenames: ['old.pdf'],
            scheduledFilenames: ['eberron.pdf'],
        });
    });

    it('parses the Foundry manifest header from an export file', async () => {
        vol.fromJSON({
            '/repo/foundry/export.ndjson': [
                JSON.stringify({
                    kind: 'manifest',
                    manifest: {
                        schemaVersion: '2.0.0',
                        run: {
                            deleteCount: 0,
                            generatedAt: '2026-05-20T00:00:00.000Z',
                            recordCount: 2,
                            runId: 'run-1',
                            upsertCount: 2,
                        },
                    },
                }),
                JSON.stringify({
                    kind: 'upsert',
                    record: {
                        body: '<p>Ignored for discovery.</p>',
                        name: 'Sharn',
                        recordId: 'journal.sharn',
                        sourceType: 'JournalEntryPage',
                    },
                }),
            ].join('\n'),
        });

        const { parseFoundryExportManifest } = await import('@server/services/refresh/discovery/foundry.js');
        const marker = await parseFoundryExportManifest('/repo/foundry', 'export.ndjson');

        expect(marker).toEqual({
            deleteCount: 0,
            filename: 'export.ndjson',
            generatedAt: '2026-05-20T00:00:00.000Z',
            recordCount: 2,
            runId: 'run-1',
            schemaVersion: '2.0.0',
            upsertCount: 2,
        });
    });
});
