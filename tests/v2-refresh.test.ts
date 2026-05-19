import Database from 'better-sqlite3';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperationEventDto } from '@/dto/index.js';
import { createTaggedError } from '@/errors.js';
import { createV2App } from '@/server/v2/app.js';
import { createAppDb, getAppDatabasePath, Settings, settingKeys, type AppDb } from '@/server/v2/db/app/index.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    getCorpusDatabasePath,
    type CorpusStore,
    type EmbeddingAdapter,
} from '@/server/v2/db/corpus/index.js';
import { createConsoleEventPublisher, createRuntimeEventPublisher } from '@/server/v2/services/index.js';
import { createRefreshCoordinator } from '@/server/v2/services/refresh/index.js';
import { createImportStateStore } from '@/server/v2/services/refresh/import-state.js';
import { createRefreshPipeline } from '@/server/v2/services/refresh/pipeline.js';
import { createRefreshStateStore } from '@/server/v2/services/refresh/refresh-state.js';
import { initializeRefreshSettings, resolveRefreshRuntimePaths } from '@/server/v2/services/refresh/runtime.js';
import { createStartupOrchestrator } from '@/server/v2/services/startup-orchestrator.js';

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
        const consoleEvents = await createConsoleEventPublisher(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        const refreshEvents: OperationEventDto[] = [];
        runtimeEvents.subscribe(event => {
            refreshEvents.push(event);
        });

        const coordinator = createRefreshCoordinator(appDb, {
            consoleEvents,
            pipeline: {
                run: async (kind, options = {}) => {
                    if (kind === 'reingest') {
                        options.reporter?.info('Reingest progress emitted.');
                        return { corpusChanged: true, kind };
                    }

                    options.reporter?.info('Refresh progress emitted.');
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
            runtimeEvents,
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
        expect(await consoleEvents.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'info', message: 'Refresh requested.' }),
            expect.objectContaining({ level: 'info', message: 'Refresh started.' }),
            expect.objectContaining({ level: 'info', message: 'Refresh progress emitted.' }),
            expect.objectContaining({ level: 'warn', message: 'Force reingest interrupted the active refresh.' }),
            expect.objectContaining({ level: 'info', message: 'Force reingest requested.' }),
            expect.objectContaining({ level: 'info', message: 'Force reingest started.' }),
            expect.objectContaining({ level: 'info', message: 'Reingest progress emitted.' }),
        ]));
        expect(refreshEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'created', kind: 'refresh', resource: 'refresh', status: 'pending' }),
            expect.objectContaining({ action: 'updated', kind: 'refresh', resource: 'refresh', status: 'running' }),
            expect.objectContaining({ action: 'updated', kind: 'refresh', resource: 'refresh', status: 'failed' }),
            expect.objectContaining({ action: 'created', kind: 'reingest', resource: 'refresh', status: 'pending' }),
            expect.objectContaining({ action: 'updated', kind: 'reingest', resource: 'refresh', status: 'running' }),
            expect.objectContaining({ action: 'completed', kind: 'reingest', resource: 'refresh', status: 'completed' }),
        ]));
    });

    it('rejects overlapping refreshes while reingest is active', async () => {
        const appDb = await createTestAppDb('coordinator-reingest-exclusive');
        const refreshStateStore = createRefreshStateStore(appDb);
        await refreshStateStore.ensure();
        let resolveReingest: (() => void) | undefined;

        const coordinator = createRefreshCoordinator(appDb, {
            pipeline: {
                run: async kind => {
                    if (kind === 'refresh') {
                        return { corpusChanged: false, kind };
                    }

                    await new Promise<void>(resolve => {
                        resolveReingest = resolve;
                    });
                    return { corpusChanged: true, kind };
                },
            },
        });

        await coordinator.startRefresh({ kind: 'reingest' });
        await flushAsyncHandlers();
        expect((await refreshStateStore.read()).reingestStatus).toBe('running');

        await expect(coordinator.startRefresh({ kind: 'refresh' })).rejects.toMatchObject({
            kind: 'refresh-operation-conflict',
        });
        await expect(coordinator.startRefresh({ kind: 'reingest' })).rejects.toMatchObject({
            kind: 'refresh-operation-conflict',
        });

        const releaseReingest = resolveReingest;
        if (releaseReingest) {
            releaseReingest();
        }
        await waitForCondition(async () => (await refreshStateStore.read()).reingestStatus === 'completed');
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

        const messages: string[] = [];
        const warnings: string[] = [];
        const result = await pipeline.run('refresh', {
            reporter: {
                info: message => {
                    messages.push(message);
                },
                progress: message => {
                    messages.push(message);
                },
                warn: message => {
                    warnings.push(message);
                },
            },
        });
        expect(result).toEqual({
            corpusChanged: true,
            kind: 'refresh',
        });
        expect(messages).toEqual(expect.arrayContaining([
            'Preparing refresh runtime settings.',
            'Starting source discovery.',
            expect.stringContaining('Source discovery complete:'),
            'Preparing corpus storage.',
            'Building ingestion change set.',
            expect.stringContaining('Ingestion change set built:'),
            expect.stringContaining('Applying 3 corpus source changes.'),
            'Refreshing retrieval artifacts.',
            expect.stringContaining('Retrieval embedding sync started:'),
            expect.stringContaining('Retrieval embedding sync progress:'),
            expect.stringContaining('Retrieval vector index synchronized:'),
            'Persisting app-owned refresh state.',
            'Refresh pipeline completed successfully.',
        ]));
        expect(warnings).toEqual([]);

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

    it('keeps console output transient by default and mirrors it into sqlite when debug is enabled', async () => {
        const transientAppDb = await createTestAppDb('console-transient');
        const transientConsole = await createConsoleEventPublisher(transientAppDb);
        await transientConsole.info('Transient entry', '2026-05-18T00:00:00.000Z');

        expect(await transientConsole.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'info',
                message: 'Transient entry',
                timestamp: '2026-05-18T00:00:00.000Z',
            }),
        ]));
        expect(await transientAppDb.db.selectFrom('consoleEntries').selectAll().execute()).toEqual([]);

        const debugAppDb = await createTestAppDb('console-debug');
        await Settings.write(debugAppDb.db, settingKeys.providerDebug, 'true');
        const debugConsole = await createConsoleEventPublisher(debugAppDb);
        await debugConsole.warn('Persisted entry', '2026-05-18T00:00:01.000Z');

        expect(await debugConsole.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                level: 'warn',
                message: 'Persisted entry',
                timestamp: '2026-05-18T00:00:01.000Z',
            }),
        ]));
        expect(await debugAppDb.db.selectFrom('consoleEntries').selectAll().execute()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                createdAt: '2026-05-18T00:00:01.000Z',
                level: 'warn',
                message: 'Persisted entry',
            }),
        ]));
    });

    it('bootstraps startup state and launches background refresh without waiting for completion', async () => {
        const repoRoot = path.join(TEST_ROOT, 'create-v2-app');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const calls: Array<{ kind: 'refresh' | 'reingest' }> = [];

        const app = await createV2App({
            appDbPath: getAppDatabasePath(runtimeDir),
            refreshCoordinatorFactory: () => ({
                startRefresh: async request => {
                    calls.push(request);
                    return new Promise(() => undefined);
                },
            }),
            repoRoot,
        });

        expect(await app.db.selectFrom('refreshState').selectAll().executeTakeFirstOrThrow()).toMatchObject({
            activeOperation: null,
            refreshStatus: 'failed',
            reingestStatus: 'failed',
        });
        expect(await Settings.read(app.db, settingKeys.retrievalDir)).toBe('.eberron-query-assistant/retrieval');
        expect(await Settings.read(app.db, settingKeys.foundrySourceDir)).toBe('foundry-export');
        expect(await Settings.read(app.db, settingKeys.pdfSourceDir)).toBe('pdf');

        await flushAsyncHandlers();
        expect(calls).toEqual([{ kind: 'refresh' }]);

        await app.close();
    });

    it('uses the same coordinator visibility path for startup refresh as manual refresh', async () => {
        const repoRoot = path.join(TEST_ROOT, 'startup-visibility');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const appDb = await createTestAppDb('startup-visibility', runtimeDir);
        const refreshStateStore = createRefreshStateStore(appDb);
        const consoleEvents = await createConsoleEventPublisher(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        const refreshEvents: OperationEventDto[] = [];
        runtimeEvents.subscribe(event => {
            refreshEvents.push(event);
        });

        const coordinator = createRefreshCoordinator(appDb, {
            consoleEvents,
            pipeline: {
                run: (kind, options = {}) => {
                    options.reporter?.info('Startup progress emitted.');
                    return Promise.resolve({ corpusChanged: false, kind });
                },
            },
            runtimeEvents,
        });
        const orchestrator = createStartupOrchestrator(appDb, {
            consoleEvents,
            refreshCoordinator: coordinator,
            repoRoot,
            runtimeEvents,
        });

        await orchestrator.bootstrap();
        orchestrator.startBackgroundRefresh();

        await waitForCondition(async () => (await refreshStateStore.read()).refreshStatus === 'completed');
        expect(await consoleEvents.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'info', message: 'Refresh requested.' }),
            expect.objectContaining({ level: 'info', message: 'Refresh started.' }),
            expect.objectContaining({ level: 'info', message: 'Startup progress emitted.' }),
        ]));
        expect(refreshEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'created', kind: 'refresh', resource: 'refresh', status: 'pending' }),
            expect.objectContaining({ action: 'updated', kind: 'refresh', resource: 'refresh', status: 'running' }),
            expect.objectContaining({ action: 'completed', kind: 'refresh', resource: 'refresh', status: 'completed' }),
        ]));
    });

    it('marks interrupted refresh failed on startup and restarts routine refresh', async () => {
        const repoRoot = path.join(TEST_ROOT, 'startup-recover-refresh');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const appDb = await createTestAppDb('startup-recover-refresh', runtimeDir);
        const refreshStateStore = createRefreshStateStore(appDb);
        const consoleEvents = await createConsoleEventPublisher(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        const refreshEvents: OperationEventDto[] = [];
        runtimeEvents.subscribe(event => {
            refreshEvents.push(event);
        });

        await refreshStateStore.ensure();
        await refreshStateStore.setRunning('refresh', '2026-05-18T00:00:00.000Z');
        const calls: Array<{ kind: 'refresh' | 'reingest' }> = [];
        const orchestrator = createStartupOrchestrator(appDb, {
            consoleEvents,
            refreshCoordinator: {
                startRefresh: request => {
                    calls.push(request);
                    return Promise.resolve({
                        activeOperation: request.kind,
                        createdAt: '2026-05-18T00:00:00.000Z',
                        lastRefreshAt: null,
                        lastReingestAt: null,
                        refreshStatus: request.kind === 'refresh' ? 'pending' : 'failed',
                        reingestStatus: request.kind === 'reingest' ? 'pending' : 'failed',
                        updatedAt: '2026-05-18T00:00:01.000Z',
                    });
                },
            },
            repoRoot,
            runtimeEvents,
        });

        await orchestrator.bootstrap();
        orchestrator.startBackgroundRefresh();

        await flushAsyncHandlers();
        expect(calls).toEqual([{ kind: 'refresh' }]);
        expect(await refreshStateStore.read()).toMatchObject({
            activeOperation: null,
            refreshStatus: 'failed',
        });
        expect(await consoleEvents.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'warn', message: 'Previous refresh was interrupted by shutdown. Restarting refresh.' }),
        ]));
        expect(refreshEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'failed', kind: 'refresh', resource: 'refresh', status: 'failed' }),
        ]));
    });

    it('marks interrupted reingest failed on startup and resumes reingest', async () => {
        const repoRoot = path.join(TEST_ROOT, 'startup-recover-reingest');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const appDb = await createTestAppDb('startup-recover-reingest', runtimeDir);
        const refreshStateStore = createRefreshStateStore(appDb);
        const consoleEvents = await createConsoleEventPublisher(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        const refreshEvents: OperationEventDto[] = [];
        runtimeEvents.subscribe(event => {
            refreshEvents.push(event);
        });

        await refreshStateStore.ensure();
        await refreshStateStore.setRunning('reingest', '2026-05-18T00:00:00.000Z');
        const calls: Array<{ kind: 'refresh' | 'reingest' }> = [];
        const orchestrator = createStartupOrchestrator(appDb, {
            consoleEvents,
            refreshCoordinator: {
                startRefresh: request => {
                    calls.push(request);
                    return Promise.resolve({
                        activeOperation: request.kind,
                        createdAt: '2026-05-18T00:00:00.000Z',
                        lastRefreshAt: null,
                        lastReingestAt: null,
                        refreshStatus: request.kind === 'refresh' ? 'pending' : 'failed',
                        reingestStatus: request.kind === 'reingest' ? 'pending' : 'failed',
                        updatedAt: '2026-05-18T00:00:01.000Z',
                    });
                },
            },
            repoRoot,
            runtimeEvents,
        });

        await orchestrator.bootstrap();
        orchestrator.startBackgroundRefresh();

        await flushAsyncHandlers();
        expect(calls).toEqual([{ kind: 'reingest' }]);
        expect(await refreshStateStore.read()).toMatchObject({
            activeOperation: null,
            reingestStatus: 'failed',
        });
        expect(await consoleEvents.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'warn', message: 'Previous force reingest was interrupted by shutdown. Restarting force reingest.' }),
        ]));
        expect(refreshEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'failed', kind: 'reingest', resource: 'refresh', status: 'failed' }),
        ]));
    });

    it('resumes interrupted reingest on startup and rebuilds the corpus successfully', async () => {
        const repoRoot = path.join(TEST_ROOT, 'startup-reingest-resume');
        const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
        const retrievalDir = path.join(runtimeDir, 'retrieval');
        const appDb = await createTestAppDb('startup-reingest-resume', runtimeDir);
        const importStateStore = createImportStateStore(appDb);
        const refreshStateStore = createRefreshStateStore(appDb);

        await writeRefreshFixtures(repoRoot);
        await refreshStateStore.ensure();

        const initialPipeline = createFixturePipeline(appDb, {
            corpusStore: createTestCorpusStore(),
            repoRoot,
        });
        await initialPipeline.run('refresh');
        expect(readSourceCount(retrievalDir)).toBe(3);
        expect(await importStateStore.listFiles('pdf')).toEqual(['rising.pdf']);

        const abortController = new AbortController();
        const destructivePipeline = createFixturePipeline(appDb, {
            articleFetcher: createFixtureArticleFetcher(),
            corpusStore: createAbortingCorpusStore(createTestCorpusStore(), abortController),
            repoRoot,
        });
        await expect(destructivePipeline.run('reingest', { abortSignal: abortController.signal })).rejects.toMatchObject({
            kind: 'operation-aborted',
        });
        expect(readSourceCount(retrievalDir)).toBe(0);
        expect(await importStateStore.listFiles('pdf')).toEqual(['rising.pdf']);

        await refreshStateStore.setRunning('reingest', '2026-05-18T00:00:02.000Z');
        const consoleEvents = await createConsoleEventPublisher(appDb);
        const runtimeEvents = createRuntimeEventPublisher();
        const refreshEvents: OperationEventDto[] = [];
        runtimeEvents.subscribe(event => {
            refreshEvents.push(event);
        });
        const coordinator = createRefreshCoordinator(appDb, {
            consoleEvents,
            pipeline: createFixturePipeline(appDb, {
                corpusStore: createTestCorpusStore(),
                repoRoot,
            }),
            runtimeEvents,
        });
        const orchestrator = createStartupOrchestrator(appDb, {
            consoleEvents,
            refreshCoordinator: coordinator,
            repoRoot,
            runtimeEvents,
        });

        await orchestrator.bootstrap();
        orchestrator.startBackgroundRefresh();

        await waitForCondition(async () => {
            const snapshot = await refreshStateStore.read();
            return snapshot.activeOperation == null && snapshot.reingestStatus === 'completed';
        });

        expect(readSourceCount(retrievalDir)).toBe(3);
        expect(readRows(retrievalDir, 'SELECT source_type, source_key, title FROM sources ORDER BY source_type, source_key')).toEqual([
            { source_key: 'https://keith-baker.com/sharn-overview/', source_type: 'article', title: 'Sharn Overview' },
            { source_key: 'journal.sharn', source_type: 'foundry', title: 'Sharn' },
            { source_key: 'rising.pdf', source_type: 'pdf', title: 'Eberron Rising' },
        ]);
        expect(await consoleEvents.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({ level: 'warn', message: 'Previous force reingest was interrupted by shutdown. Restarting force reingest.' }),
            expect.objectContaining({ level: 'info', message: 'Force reingest requested.' }),
            expect.objectContaining({ level: 'info', message: 'Force reingest started.' }),
        ]));
        expect(refreshEvents).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'failed', kind: 'reingest', resource: 'refresh', status: 'failed' }),
            expect.objectContaining({ action: 'created', kind: 'reingest', resource: 'refresh', status: 'pending' }),
            expect.objectContaining({ action: 'updated', kind: 'reingest', resource: 'refresh', status: 'running' }),
            expect.objectContaining({ action: 'completed', kind: 'reingest', resource: 'refresh', status: 'completed' }),
        ]));
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

const waitForCondition = async (
    predicate: () => Promise<boolean>,
    attempts = 100,
): Promise<void> => {
    for (let index = 0; index < attempts; index += 1) {
        if (await predicate()) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 10));
    }

    throw new Error('Timed out waiting for condition.');
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

const createFixturePipeline = (
    appDb: AppDb,
    options: {
        articleFetcher?: { fetchText(url: string, options?: { signal?: AbortSignal | undefined }): Promise<string> };
        corpusStore?: CorpusStore;
        repoRoot: string;
    },
) => createRefreshPipeline(appDb, {
    articleFetcher: options.articleFetcher ?? createFixtureArticleFetcher(),
    corpusStore: options.corpusStore,
    pdfParser: {
        parse: () => Promise.resolve({
            fingerprint: 'fingerprint-1',
            pageCount: 1,
            pages: [{ pageNumber: 1, text: 'Eberron spans Khorvaire.' }],
            title: 'Eberron Rising',
        }),
    },
    repoRoot: options.repoRoot,
    retrievalFactory: reporter => Promise.resolve(createCorpusRetrievalService({
        embeddingAdapter: keywordEmbeddingAdapter('sharn', 'eberron', 'towers'),
        reporter,
    })),
});

const createFixtureArticleFetcher = () => ({
    fetchText: (url: string, options?: { signal?: AbortSignal | undefined }) => {
        if (options?.signal?.aborted) {
            const error = new Error('Refresh aborted.');
            Object.assign(error, createTaggedError('operation-aborted', 'Refresh aborted.'));
            return Promise.reject(error);
        }

        if (url.endsWith('/eberron-index/')) {
            return Promise.resolve('<main><a href="https://keith-baker.com/sharn-overview/">Sharn Overview</a></main>');
        }

        return Promise.resolve('<article><h1>Sharn Overview</h1><p>The City of Towers reaches high above the Dagger River.</p></article>');
    },
});

const createAbortingCorpusStore = (store: CorpusStore, abortController: AbortController): CorpusStore => ({
    ...store,
    clear: async retrievalDir => {
        await store.clear(retrievalDir);
        abortController.abort();
    },
});

const writeRefreshFixtures = async (repoRoot: string): Promise<void> => {
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
};

const readSourceCount = (retrievalDir: string): number => (
    readRows(retrievalDir, 'SELECT COUNT(*) AS count FROM sources')[0]?.count as number
);

const readRows = (retrievalDir: string, sql: string): Array<Record<string, unknown>> => {
    const database = new Database(getCorpusDatabasePath(retrievalDir), { readonly: true });
    try {
        return database.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
        database.close();
    }
};
