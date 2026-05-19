import Database from 'better-sqlite3';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTaggedError } from '@/errors.js';
import { createAppDb, getAppDatabasePath, Settings, settingKeys, type AppDb } from '@/server/v2/db/app/index.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    getCorpusDatabasePath,
    type CorpusStore,
    type EmbeddingAdapter,
} from '@/server/v2/db/corpus/index.js';
import { createRefreshCoordinator } from '@/server/v2/services/refresh/index.js';
import { createImportStateStore } from '@/server/v2/services/refresh/import-state.js';
import { createRefreshPipeline } from '@/server/v2/services/refresh/pipeline.js';
import { createRefreshStateStore } from '@/server/v2/services/refresh/refresh-state.js';
import { initializeRefreshSettings, resolveRefreshRuntimePaths } from '@/server/v2/services/refresh/runtime.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-refresh');
const appDbs: AppDb[] = [];
const corpusStores: CorpusStore[] = [];

afterEach(async () => {
    for (const store of corpusStores.splice(0)) {
        store.close();
    }
    for (const appDb of appDbs.splice(0)) {
        await appDb.close();
    }
    await rm(TEST_ROOT, { force: true, recursive: true });
});

describe('v2 refresh flow', () => {
    it('advances refresh state through pending, running, completed, and failed', async () => {
        const appDb = await createTestAppDb('refresh-state');
        const refreshStateStore = createRefreshStateStore(appDb);

        await refreshStateStore.ensure();
        let snapshot = await refreshStateStore.read();
        expect(snapshot.refreshStatus).toBe('failed');
        expect(snapshot.reingestStatus).toBe('failed');

        snapshot = await refreshStateStore.setPending('refresh', '2026-05-18T00:00:00.000Z');
        expect(snapshot.activeOperation).toBe('refresh');
        expect(snapshot.refreshStatus).toBe('pending');

        snapshot = await refreshStateStore.setRunning('refresh', '2026-05-18T00:00:01.000Z');
        expect(snapshot.refreshStatus).toBe('running');

        snapshot = await refreshStateStore.complete('refresh', '2026-05-18T00:00:02.000Z');
        expect(snapshot.activeOperation).toBeNull();
        expect(snapshot.lastRefreshAt).toBe('2026-05-18T00:00:02.000Z');
        expect(snapshot.refreshStatus).toBe('completed');

        snapshot = await refreshStateStore.setPending('reingest', '2026-05-18T00:00:03.000Z');
        snapshot = await refreshStateStore.fail('reingest', '2026-05-18T00:00:04.000Z');
        expect(snapshot.activeOperation).toBeNull();
        expect(snapshot.reingestStatus).toBe('failed');
    });

    it('rejects overlapping refreshes and lets reingest interrupt refresh', async () => {
        const appDb = await createTestAppDb('coordinator');
        const refreshStateStore = createRefreshStateStore(appDb);
        await refreshStateStore.ensure();

        const coordinator = createRefreshCoordinator(appDb, {
            pipeline: {
                run: async (kind, options = {}) => {
                    if (kind === 'reingest') {
                        return { corpusChanged: true, kind };
                    }

                    await new Promise<void>((resolve, reject) => {
                        options.abortSignal?.addEventListener('abort', () => {
                            const error = new Error('Refresh aborted.');
                            Object.assign(error, createTaggedError('operation-aborted', 'Refresh aborted.'));
                            reject(error);
                        }, { once: true });
                    });
                    return { corpusChanged: false, kind };
                },
            },
        });

        const first = await coordinator.startRefresh({ kind: 'refresh' });
        expect(first.refreshStatus).toBe('pending');

        await flushAsyncHandlers();
        expect((await refreshStateStore.read()).refreshStatus).toBe('running');

        await expect(coordinator.startRefresh({ kind: 'refresh' })).rejects.toMatchObject({
            kind: 'refresh-operation-conflict',
        });

        const second = await coordinator.startRefresh({ kind: 'reingest' });
        expect(second.activeOperation).toBe('reingest');
        expect(second.reingestStatus).toBe('pending');

        await flushAsyncHandlers();
        expect(await refreshStateStore.read()).toMatchObject({
            activeOperation: null,
            refreshStatus: 'failed',
            reingestStatus: 'completed',
        });
    });

    it('discovers, ingests, and persists refresh state through db/app and db/corpus', async () => {
        const repoRoot = path.join(TEST_ROOT, 'pipeline');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const appDb = await createTestAppDb('pipeline', runtimeDir);
        const corpusStore = createTestCorpusStore();
        const importStateStore = createImportStateStore(appDb);

        await mkdir(path.join(repoRoot, 'foundry-export'), { recursive: true });
        await mkdir(path.join(repoRoot, 'pdf'), { recursive: true });
        await writeFile(
            path.join(repoRoot, 'foundry-export', '20260518T120000000Z-foundry-export.ndjson'),
            [
                JSON.stringify({
                    kind: 'manifest',
                    manifest: {
                        schemaVersion: '2.0.0',
                        run: {
                            deleteCount: 0,
                            generatedAt: '2026-05-18T12:00:00.000Z',
                            recordCount: 1,
                            runId: 'run-1',
                            upsertCount: 1,
                        },
                    },
                }),
                JSON.stringify({
                    kind: 'upsert',
                    record: {
                        body: '<p>Sharn rises in towers.</p>',
                        metadata: {
                            provenance: {
                                path: ['Eberron', 'Sharn'],
                            },
                        },
                        name: 'Sharn',
                        recordId: 'journal.sharn',
                        sourceType: 'JournalEntryPage',
                    },
                }),
            ].join('\n'),
            'utf8',
        );
        await writeFile(path.join(repoRoot, 'pdf', 'rising.pdf'), '', 'utf8');

        const pipeline = createRefreshPipeline(appDb, {
            articleFetcher: {
                fetchText: (url: string) => Promise.resolve((() => {
                    if (url.endsWith('/eberron-index/')) {
                        return '<main><a href="https://keith-baker.com/sharn-overview/">Sharn Overview</a></main>';
                    }

                    return '<article><h1>Sharn Overview</h1><p>The City of Towers reaches high above the Dagger River.</p></article>';
                })()),
            },
            corpusStore,
            importStateStore,
            pdfParser: {
                parse: () => Promise.resolve({
                    fingerprint: 'fingerprint-1',
                    pageCount: 1,
                    pages: [{ pageNumber: 1, text: 'Eberron spans Khorvaire.' }],
                    title: 'Eberron Rising',
                }),
            },
            repoRoot,
            retrievalFactory: reporter => Promise.resolve(createCorpusRetrievalService({
                embeddingAdapter: keywordEmbeddingAdapter('sharn', 'eberron', 'towers'),
                reporter,
            })),
        });

        const result = await pipeline.run('refresh');
        expect(result).toEqual({
            corpusChanged: true,
            kind: 'refresh',
        });

        expect(await importStateStore.listFiles('foundry')).toEqual(['20260518T120000000Z-foundry-export.ndjson']);
        expect(await importStateStore.listFiles('pdf')).toEqual(['rising.pdf']);
        expect(await importStateStore.listArticles()).toEqual([
            expect.objectContaining({
                canonicalUrl: 'https://keith-baker.com/sharn-overview/',
                scrapeStatus: 'succeeded',
                title: 'Sharn Overview',
            }),
        ]);
        expect(await importStateStore.readArticleLastSuccessfulIndexScrapeAt()).toBeTruthy();

        const corpusRows = readRows(path.join(runtimeDir, 'retrieval'), 'SELECT source_type, source_key, title FROM sources ORDER BY source_type, source_key');
        expect(corpusRows).toEqual([
            { source_key: 'https://keith-baker.com/sharn-overview/', source_type: 'article', title: 'Sharn Overview' },
            { source_key: 'journal.sharn', source_type: 'foundry', title: 'Sharn' },
            { source_key: 'rising.pdf', source_type: 'pdf', title: 'Eberron Rising' },
        ]);
        expect(readRows(path.join(runtimeDir, 'retrieval'), 'SELECT key, value FROM retrieval_metadata')).toEqual([
            { key: 'vector_store_schema_version', value: 'sqlite-json-v1' },
        ]);
        expect(readRows(path.join(runtimeDir, 'retrieval'), 'SELECT COUNT(*) AS count FROM chunk_vectors')).toEqual([
            { count: 3 },
        ]);
    });

    it('seeds and resolves refresh runtime settings from appdb', async () => {
        const repoRoot = path.join(TEST_ROOT, 'runtime-settings');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const appDb = await createTestAppDb('runtime-settings', runtimeDir);

        await initializeRefreshSettings(appDb, repoRoot);
        expect(await Settings.read(appDb.db, settingKeys.foundrySourceDir)).toBe('foundry-export');
        expect(await Settings.read(appDb.db, settingKeys.pdfSourceDir)).toBe('pdf');
        expect(await Settings.read(appDb.db, settingKeys.retrievalDir)).toBe('.eberron-query-assistant/retrieval');
        expect(await Settings.read(appDb.db, settingKeys.articleHtmlCacheDir)).toBe('.eberron-query-assistant/cache/keith-baker');

        await Settings.write(appDb.db, settingKeys.foundrySourceDir, 'custom/foundry');
        await Settings.write(appDb.db, settingKeys.pdfSourceDir, 'custom/pdfs');
        await Settings.write(appDb.db, settingKeys.retrievalDir, 'custom/retrieval');
        await Settings.write(appDb.db, settingKeys.articleHtmlCacheDir, 'custom/cache/html');

        const paths = await resolveRefreshRuntimePaths(appDb, repoRoot);
        expect(paths).toMatchObject({
            articleHtmlCacheDir: path.resolve(repoRoot, 'custom/cache/html'),
            foundryExportDir: path.resolve(repoRoot, 'custom/foundry'),
            pdfDir: path.resolve(repoRoot, 'custom/pdfs'),
            retrievalDir: path.resolve(repoRoot, 'custom/retrieval'),
            repoRoot,
        });
    });
});

const createTestAppDb = async (name: string, runtimeDir = path.join(TEST_ROOT, name, '.eberron-query-assistant')): Promise<AppDb> => {
    const appDb = await createAppDb(getAppDatabasePath(runtimeDir));
    appDbs.push(appDb);
    return appDb;
};

const createTestCorpusStore = (): CorpusStore => {
    const store = createCorpusStore();
    corpusStores.push(store);
    return store;
};

const flushAsyncHandlers = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0));
};

const keywordEmbeddingAdapter = (...keywords: string[]): EmbeddingAdapter => {
    const embedKeywordVector = (input: string): number[] => {
        const lower = input.toLowerCase();
        const vector = keywords.map(keyword => (lower.includes(keyword) ? 1 : 0));
        return vector.some(value => value > 0) ? vector : keywords.map(() => 0);
    };

    return {
        embed: (input) => Promise.resolve(embedKeywordVector(input)),
        embedBatch: vi.fn((inputs: string[]) => Promise.resolve(inputs.map(embedKeywordVector))),
        failedRetries: 0,
        modelId: `keyword-${keywords.join('-')}`,
        schemaVersion: 'keyword-v1',
    };
};

const readRows = (retrievalDir: string, sql: string): Array<Record<string, unknown>> => {
    const database = new Database(getCorpusDatabasePath(retrievalDir), { readonly: true });
    try {
        return database.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
        database.close();
    }
};
