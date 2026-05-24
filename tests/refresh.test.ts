import { fs, vol } from 'memfs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDb } from '@server/db/app/db.js';
import { settingsStore } from '@server/db/app/index.js';
import { createRefreshCoordinator } from '@server/services/refresh/coordinator.js';
import { createRefreshPipeline } from '@server/services/refresh/pipeline.js';
import { recoverStartupRefreshOperation } from '@server/services/refresh/startup-recovery.js';

import { createInMemoryAppDb } from './support/app-db.js';

vi.mock('node:fs/promises', () => fs.promises);

describe('refresh file discovery', () => {
    beforeEach(() => {
        vol.reset();
    });

    afterEach(() => {
        vol.reset();
        vi.restoreAllMocks();
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

    it('allows a reingest request to replace an active refresh', async () => {
        const timeline: string[] = [];
        let releaseRefresh: (() => void) | undefined;
        const pipeline = {
            run: vi.fn((kind: 'refresh' | 'reingest') => {
                timeline.push(`run:${kind}`);
                if (kind === 'refresh') {
                    return new Promise<{ corpusChanged: boolean; kind: 'refresh' | 'reingest' }>(resolve => {
                        releaseRefresh = () => {
                            timeline.push('refresh:done');
                            resolve({ corpusChanged: true, kind });
                        };
                    });
                }
                return Promise.resolve({ corpusChanged: true, kind });
            }),
        };
        const refreshStateStore = createRefreshStateStoreFake();
        const visibility = createVisibilityFake();
        const coordinator = createRefreshCoordinator({} as AppDb, {
            pipeline,
            refreshStateStore,
            visibility,
        });

        const first = coordinator.startRefresh({ kind: 'refresh' });
        await vi.waitFor(() => expect(pipeline.run).toHaveBeenCalledWith('refresh', expect.any(Object)));
        const second = coordinator.startRefresh({ kind: 'reingest' });
        releaseRefresh?.();
        await Promise.all([first, second]);

        expect(visibility.publishInterrupted).toHaveBeenCalledTimes(1);
        expect(timeline).toContain('run:reingest');
    });

    it('rejects refresh conflicts that are not refresh replaced by reingest', async () => {
        const pipeline = {
            run: vi.fn(() => new Promise<{ corpusChanged: boolean; kind: 'refresh' | 'reingest' }>(() => undefined)),
        };
        const coordinator = createRefreshCoordinator({} as AppDb, {
            pipeline,
            refreshStateStore: createRefreshStateStoreFake(),
            visibility: createVisibilityFake(),
        });

        void coordinator.startRefresh({ kind: 'refresh' });
        await vi.waitFor(() => expect(pipeline.run).toHaveBeenCalledTimes(1));

        await expect(coordinator.startRefresh({ kind: 'refresh' })).rejects.toThrow('Cannot start refresh while refresh is active.');
    });

    it('marks an orphaned persisted active operation as failed before starting a new one', async () => {
        const refreshStateStore = createRefreshStateStoreFake({
            activeOperation: 'refresh',
            refreshStatus: 'running',
        });
        const coordinator = createRefreshCoordinator({} as AppDb, {
            pipeline: { run: vi.fn().mockResolvedValue({ corpusChanged: true, kind: 'refresh' }) },
            refreshStateStore,
            visibility: createVisibilityFake(),
        });

        await coordinator.startRefresh({ kind: 'refresh' });

        expect(refreshStateStore.fail).toHaveBeenCalledWith('refresh', expect.any(String));
    });

    it('records pending running completed lifecycle transitions', async () => {
        const refreshStateStore = createRefreshStateStoreFake();
        const visibility = createVisibilityFake();
        const coordinator = createRefreshCoordinator({} as AppDb, {
            pipeline: { run: vi.fn().mockResolvedValue({ corpusChanged: true, kind: 'refresh' }) },
            refreshStateStore,
            visibility,
        });

        await coordinator.startRefresh({ kind: 'refresh' });
        await vi.waitFor(() => expect(refreshStateStore.complete).toHaveBeenCalledTimes(1));

        expect(refreshStateStore.setPending).toHaveBeenCalledTimes(1);
        expect(refreshStateStore.setRunning).toHaveBeenCalledTimes(1);
        expect(refreshStateStore.complete).toHaveBeenCalledTimes(1);
        expect(visibility.publishPending).toHaveBeenCalledTimes(1);
        expect(visibility.publishRunning).toHaveBeenCalledTimes(1);
        expect(visibility.publishCompleted).toHaveBeenCalledTimes(1);
    });

    it('records failed lifecycle transitions for non-abort pipeline errors', async () => {
        const refreshStateStore = createRefreshStateStoreFake();
        const visibility = createVisibilityFake();
        const coordinator = createRefreshCoordinator({} as AppDb, {
            pipeline: { run: vi.fn().mockRejectedValue(new Error('boom')) },
            refreshStateStore,
            visibility,
        });

        await coordinator.startRefresh({ kind: 'refresh' });
        await vi.waitFor(() => expect(refreshStateStore.fail).toHaveBeenCalled());

        expect(refreshStateStore.fail).toHaveBeenCalledWith('refresh', expect.any(String));
        expect(visibility.publishFailed).toHaveBeenCalledWith('refresh', expect.any(String), 'Refresh refresh failed.');
    });

    it('recovers startup refresh as refresh after interrupted refresh', async () => {
        const visibility = createVisibilityFake();
        const result = await recoverStartupRefreshOperation({
            now: () => new Date('2026-05-20T00:00:00.000Z'),
            refreshStateStore: createRefreshStateStoreFake({
                activeOperation: 'refresh',
                refreshStatus: 'running',
            }),
            visibility,
        });

        expect(result).toBe('refresh');
        expect(visibility.publishRecoveredAfterShutdown).toHaveBeenCalledWith(
            'refresh',
            'refresh',
            '2026-05-20T00:00:00.000Z',
        );
    });

    it('recovers startup refresh as reingest after interrupted reingest', async () => {
        const visibility = createVisibilityFake();
        const result = await recoverStartupRefreshOperation({
            now: () => new Date('2026-05-20T00:00:00.000Z'),
            refreshStateStore: createRefreshStateStoreFake({
                activeOperation: 'reingest',
                reingestStatus: 'running',
            }),
            visibility,
        });

        expect(result).toBe('reingest');
        expect(visibility.publishRecoveredAfterShutdown).toHaveBeenCalledWith(
            'reingest',
            'reingest',
            '2026-05-20T00:00:00.000Z',
        );
    });

    it('rejects absolute persisted runtime paths', async () => {
        const appDb = await createInMemoryAppDb();
        await settingsStore().write(appDb, 'retrievalDir', 'C:\\absolute\\retrieval');
        const pipeline = createRefreshPipeline(appDb, {
            articleFetcher: { fetchText: vi.fn() },
            corpusStore: createCorpusStoreFake(),
            importStateStore: createImportStateStoreFake(),
            pdfParser: { parse: vi.fn().mockResolvedValue({ fingerprint: null, pageCount: 0, pages: [], title: null }) },
            retrievalFactory: vi.fn().mockResolvedValue(null),
            repoRoot: 'C:\\repo',
        });

        await expect(pipeline.run('refresh')).rejects.toThrow('must be relative to the repo root');
        await appDb.destroy();
    });

    it('fails refresh when the resulting corpus is empty', async () => {
        vi.doMock('@server/services/refresh/discovery/index.js', () => ({
            discoverRefreshWork: vi.fn().mockResolvedValue(createDiscoveryResult()),
        }));
        vi.doMock('@server/services/refresh/ingestion/index.js', () => ({
            buildRefreshIngestion: vi.fn().mockResolvedValue(createIngestionResult()),
        }));
        const { createRefreshPipeline: createPatchedPipeline } = await import('@server/services/refresh/pipeline.js');
        const appDb = await createInMemoryAppDb();
        const pipeline = createPatchedPipeline(appDb, {
            articleFetcher: { fetchText: vi.fn() },
            corpusStore: createCorpusStoreFake({ countSources: 0 }),
            importStateStore: createImportStateStoreFake(),
            pdfParser: { parse: vi.fn().mockResolvedValue({ fingerprint: null, pageCount: 0, pages: [], title: null }) },
            retrievalFactory: vi.fn().mockResolvedValue(null),
            repoRoot: '/repo',
        });

        await expect(pipeline.run('refresh')).rejects.toThrow('Refresh produced no ingestible corpus sources.');
        await appDb.destroy();
    });

    it('skips retrieval rebuild when corpus is unchanged', async () => {
        vi.doMock('@server/services/refresh/discovery/index.js', () => ({
            discoverRefreshWork: vi.fn().mockResolvedValue(createDiscoveryResult()),
        }));
        vi.doMock('@server/services/refresh/ingestion/index.js', () => ({
            buildRefreshIngestion: vi.fn().mockResolvedValue(createIngestionResult({ corpusChanged: false })),
        }));
        const { createRefreshPipeline: createPatchedPipeline } = await import('@server/services/refresh/pipeline.js');
        const appDb = await createInMemoryAppDb();
        const retrieval = {
            prepare: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn(),
        };
        const pipeline = createPatchedPipeline(appDb, {
            articleFetcher: { fetchText: vi.fn() },
            corpusStore: createCorpusStoreFake(),
            importStateStore: createImportStateStoreFake(),
            pdfParser: { parse: vi.fn().mockResolvedValue({ fingerprint: null, pageCount: 0, pages: [], title: null }) },
            repoRoot: '/repo',
            retrievalFactory: vi.fn().mockResolvedValue(retrieval),
        });

        await pipeline.run('refresh');

        expect(retrieval.prepare).toHaveBeenCalledTimes(1);
        expect(retrieval.refresh).not.toHaveBeenCalled();
        await appDb.destroy();
    });

    it('forces retrieval rebuild during reingest', async () => {
        vi.doMock('@server/services/refresh/discovery/index.js', () => ({
            discoverRefreshWork: vi.fn().mockResolvedValue(createDiscoveryResult()),
        }));
        vi.doMock('@server/services/refresh/ingestion/index.js', () => ({
            buildRefreshIngestion: vi.fn().mockResolvedValue(createIngestionResult({ corpusChanged: true })),
        }));
        const { createRefreshPipeline: createPatchedPipeline } = await import('@server/services/refresh/pipeline.js');
        const appDb = await createInMemoryAppDb();
        const retrieval = {
            prepare: vi.fn(),
            refresh: vi.fn().mockResolvedValue(undefined),
        };
        const pipeline = createPatchedPipeline(appDb, {
            articleFetcher: { fetchText: vi.fn() },
            corpusStore: createCorpusStoreFake(),
            importStateStore: createImportStateStoreFake(),
            pdfParser: { parse: vi.fn().mockResolvedValue({ fingerprint: null, pageCount: 0, pages: [], title: null }) },
            repoRoot: '/repo',
            retrievalFactory: vi.fn().mockResolvedValue(retrieval),
        });

        await pipeline.run('reingest');

        const [retrievalDir, options] = retrieval.refresh.mock.calls[0] as [string, { abortSignal: undefined; forceRebuild: boolean }];
        expect(retrievalDir).toBe(path.resolve('/repo', '.eberron-query-assistant/retrieval'));
        expect(options).toEqual({
            abortSignal: undefined,
            forceRebuild: true,
        });
        await appDb.destroy();
    });

    it('persists import-state updates only after corpus and retrieval succeed', async () => {
        vi.doMock('@server/services/refresh/discovery/index.js', () => ({
            discoverRefreshWork: vi.fn().mockResolvedValue(createDiscoveryResult()),
        }));
        vi.doMock('@server/services/refresh/ingestion/index.js', () => ({
            buildRefreshIngestion: vi.fn().mockResolvedValue(createIngestionResult()),
        }));
        const { createRefreshPipeline: createPatchedPipeline } = await import('@server/services/refresh/pipeline.js');
        const appDb = await createInMemoryAppDb();
        const importStateStore = createImportStateStoreFake();
        const pipeline = createPatchedPipeline(appDb, {
            articleFetcher: { fetchText: vi.fn() },
            corpusStore: createCorpusStoreFake(),
            importStateStore,
            pdfParser: { parse: vi.fn().mockResolvedValue({ fingerprint: null, pageCount: 0, pages: [], title: null }) },
            repoRoot: '/repo',
            retrievalFactory: vi.fn().mockResolvedValue({
                prepare: vi.fn(),
                refresh: vi.fn().mockRejectedValue(new Error('retrieval failed')),
            }),
        });

        await expect(pipeline.run('refresh')).rejects.toThrow('retrieval failed');
        expect(importStateStore.replaceFiles).not.toHaveBeenCalled();
        expect(importStateStore.replaceArticles).not.toHaveBeenCalled();
        await appDb.destroy();
    });
});

const createRefreshStateStoreFake = (overrides: Partial<{
    activeOperation: 'refresh' | 'reingest' | null;
    refreshStatus: 'pending' | 'running' | 'completed' | 'failed';
    reingestStatus: 'pending' | 'running' | 'completed' | 'failed';
}> = {}) => {
    const snapshot: {
        activeOperation: 'refresh' | 'reingest' | null;
        createdAt: string;
        lastRefreshAt: string | null;
        lastReingestAt: string | null;
        refreshStatus: 'pending' | 'running' | 'completed' | 'failed';
        reingestStatus: 'pending' | 'running' | 'completed' | 'failed';
        singletonKey: number;
        updatedAt: string;
    } = {
        activeOperation: overrides.activeOperation ?? null,
        createdAt: '2026-05-20T00:00:00.000Z',
        lastRefreshAt: null,
        lastReingestAt: null,
        refreshStatus: overrides.refreshStatus ?? 'failed',
        reingestStatus: overrides.reingestStatus ?? 'failed',
        singletonKey: 1,
        updatedAt: '2026-05-20T00:00:00.000Z',
    };

    return {
        complete: vi.fn((kind: 'refresh' | 'reingest', now: string) => {
            snapshot.activeOperation = null;
            snapshot.updatedAt = now;
            if (kind === 'refresh') {
                snapshot.refreshStatus = 'completed';
                snapshot.lastRefreshAt = now;
            } else {
                snapshot.reingestStatus = 'completed';
                snapshot.lastReingestAt = now;
            }
            return Promise.resolve({ ...snapshot });
        }),
        ensure: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn((kind: 'refresh' | 'reingest', now: string) => {
            snapshot.activeOperation = null;
            snapshot.updatedAt = now;
            if (kind === 'refresh') {
                snapshot.refreshStatus = 'failed';
            } else {
                snapshot.reingestStatus = 'failed';
            }
            return Promise.resolve({ ...snapshot });
        }),
        read: vi.fn(() => Promise.resolve({ ...snapshot })),
        setPending: vi.fn((kind: 'refresh' | 'reingest', now: string) => {
            snapshot.activeOperation = kind;
            snapshot.updatedAt = now;
            if (kind === 'refresh') {
                snapshot.refreshStatus = 'pending';
            } else {
                snapshot.reingestStatus = 'pending';
            }
            return Promise.resolve({ ...snapshot });
        }),
        setRunning: vi.fn((kind: 'refresh' | 'reingest', now: string) => {
            snapshot.activeOperation = kind;
            snapshot.updatedAt = now;
            if (kind === 'refresh') {
                snapshot.refreshStatus = 'running';
            } else {
                snapshot.reingestStatus = 'running';
            }
            return Promise.resolve({ ...snapshot });
        }),
    };
};

const createVisibilityFake = () => ({
    publishCompleted: vi.fn(),
    publishFailed: vi.fn().mockResolvedValue(undefined),
    publishInterrupted: vi.fn().mockResolvedValue(undefined),
    publishPending: vi.fn().mockResolvedValue(undefined),
    publishRecoveredAfterShutdown: vi.fn().mockResolvedValue(undefined),
    publishRunning: vi.fn().mockResolvedValue(undefined),
    reporterFor: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
    })),
});

const createCorpusStoreFake = (overrides: Partial<{
    countSources: number;
}> = {}) => ({
    applySourceChanges: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    countSources: vi.fn().mockResolvedValue(overrides.countSources ?? 1),
    initialize: vi.fn().mockResolvedValue(undefined),
    removeSource: vi.fn().mockResolvedValue(undefined),
    removeSourcesByType: vi.fn().mockResolvedValue(undefined),
    rebuildSearchIndex: vi.fn().mockResolvedValue(undefined),
    replaceSource: vi.fn().mockResolvedValue(undefined),
    replaceSourcesByType: vi.fn().mockResolvedValue(undefined),
    writeChunks: vi.fn().mockResolvedValue(undefined),
});

const createImportStateStoreFake = () => ({
    listArticles: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    readArticleLastSuccessfulIndexScrapeAt: vi.fn().mockResolvedValue(undefined),
    readFoundry: vi.fn().mockResolvedValue(null),
    replaceArticles: vi.fn().mockResolvedValue(undefined),
    replaceFiles: vi.fn().mockResolvedValue(undefined),
    writeArticleLastSuccessfulIndexScrapeAt: vi.fn().mockResolvedValue(undefined),
    writeFoundry: vi.fn().mockResolvedValue(undefined),
});

const createDiscoveryResult = () => ({
    article: {
        currentArticles: [],
        shouldRefreshIndex: false,
    },
    foundry: {
        markers: [],
        scheduledMarkers: [],
    },
    pdf: {
        currentFilenames: [],
        removedFilenames: [],
        scheduledFilenames: [],
    },
});

const createIngestionResult = (overrides: Partial<{ corpusChanged: boolean }> = {}) => ({
    articleRows: [],
    corpusChanged: overrides.corpusChanged ?? true,
    foundryAppliedMarkers: [],
    pdfFilenames: [],
    sourceChangeSet: {
        changes: [],
    },
});
