import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { chunkText } from '@server/services/refresh/ingestion/chunking.js';
import { buildFoundrySourceChanges } from '@server/services/refresh/ingestion/foundry.js';
import { buildPdfSourceChanges } from '@server/services/refresh/ingestion/pdf.js';
import { buildArticleRefresh, ArticleFetcher } from '@server/services/refresh/ingestion/article.js';
import { PdfParser, RuntimePaths } from '@server/services/refresh/types.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    createPartyContextService,
    getCorpusDatabasePath,
    getVectorIndexPath,
    CorpusStore,
    EmbeddingAdapter,
    ProgressReporter,
} from '@server/db/corpus/index.js';
import { settingsStore } from '@server/db/app/index.js';
import { CorpusChunk, CorpusSource, SourceType } from '@/types.js';
import { createInMemoryAppDb } from './support/app-db.js';

describe('v2 corpus boundary', () => {
    let appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>;

    beforeAll(async () => {
        appDb = await createInMemoryAppDb();
    });

    afterAll(async () => {
        await appDb.destroy();
    });

    it('chunks normalized text into stable chunk boundaries', () => {
        // Five paragraphs of 513 chars each. The fourth paragraph pushes the
        // running total past the 1 600-char target, so the chunker flushes after
        // paragraph 2 and the second chunk holds paragraphs 3-4.
        const paragraph = (label: string): string => `Paragraph ${label}: ${'x'.repeat(500)}`;
        const text = Array.from({ length: 5 }, (_, i) => paragraph(String(i))).join('\n\n');
        const chunks = chunkText(text);

        expect(chunks.length).toBe(2);
        expect(chunks[0]!.startParagraph).toBe(0);
        expect(chunks[0]!.endParagraph).toBe(2);
        expect(chunks[1]!.startParagraph).toBe(3);
        expect(chunks[1]!.endParagraph).toBe(4);
    });

    describe('source ingestion builders', () => {
        let tmpDir: string;

        beforeEach(async () => {
            tmpDir = await mkdtemp(path.join(os.tmpdir(), 'eqa-ingestion-'));
        });

        afterEach(async () => {
            await rm(tmpDir, { force: true, recursive: true });
        });

        it('builds foundry source changes from export records', async () => {
            const manifest = {
                kind: 'manifest',
                manifest: {
                    schemaVersion: '2.0.0',
                    run: {
                        runId: 'run-001',
                        generatedAt: '2024-01-01T00:00:00.000Z',
                        recordCount: 1,
                        upsertCount: 1,
                        deleteCount: 0,
                    },
                },
            };
            const record = {
                kind: 'upsert',
                record: {
                    recordId: 'actor-sharn',
                    name: 'Sharn City',
                    body: 'Sharn is a vertical city of towers in Breland.',
                },
            };
            await writeFile(
                path.join(tmpDir, 'export.ndjson'),
                [JSON.stringify(manifest), JSON.stringify(record)].join('\n'),
                'utf8',
            );

            const paths: RuntimePaths = {
                foundryExportDir: tmpDir,
                pdfDir: '',
                repoRoot: '',
                retrievalDir: '',
                articleHtmlCacheDir: '',
            };
            const marker = {
                deleteCount: 0,
                filename: 'export.ndjson',
                generatedAt: '2024-01-01T00:00:00.000Z',
                recordCount: 1,
                runId: 'run-001',
                schemaVersion: '2.0.0',
                upsertCount: 1,
            };

            const result = await buildFoundrySourceChanges(paths, [marker], false);

            expect(result.changeSet.changes.length).toBe(1);
            const change = result.changeSet.changes[0];
            expect(change?.kind).toBe('upsert');
            const upsert = change as { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource };
            expect(upsert.source.sourceKey).toBe('actor-sharn');
            expect(upsert.chunks.length).toBeGreaterThan(0);
        });

        it('builds pdf source changes from parsed pages', async () => {
            const mockParser: PdfParser = {
                parse: vi.fn().mockResolvedValue({
                    fingerprint: 'pdf-fingerprint',
                    pageCount: 1,
                    pages: [{ pageNumber: 1, text: 'Sharn is a vertical city of towers.' }],
                    title: 'Sharn Guide',
                }),
            };
            const paths: RuntimePaths = {
                foundryExportDir: '',
                pdfDir: tmpDir,
                repoRoot: '',
                retrievalDir: '',
                articleHtmlCacheDir: '',
            };

            const changeSet = await buildPdfSourceChanges(paths, ['sharn.pdf'], [], mockParser, false);

            expect(changeSet.changes.length).toBe(1);
            expect(changeSet.changes[0]).toMatchObject({ kind: 'upsert' });
            const upsert = changeSet.changes[0] as { kind: 'upsert'; chunks: CorpusChunk[]; source: CorpusSource };
            expect(upsert.source.sourceKey).toBe('sharn.pdf');
            expect(upsert.source.title).toBe('Sharn Guide');
            expect(upsert.chunks.length).toBeGreaterThan(0);
        });

        it('builds article source changes from fetched article content', async () => {
            // The article index URL comes from settingsStore and defaults to
            // 'https://keith-baker.com/eberron-index/' (set in beforeAll via createInMemoryAppDb).
            const mockFetcher: ArticleFetcher = {
                fetchText: vi.fn((url: string) => {
                    if (url.includes('eberron-index')) {
                        return Promise.resolve('<html><body><a href="https://keith-baker.com/sharn-overview/">Sharn</a></body></html>');
                    }
                    return Promise.resolve('<html><body><article><h1>Sharn Overview</h1><p>Sharn is a city of towers.</p></article></body></html>');
                }),
            };

            const result = await buildArticleRefresh({
                currentArticles: [],
                fetcher: mockFetcher,
                forceReingest: false,
                now: '2024-01-01T00:00:00.000Z',
                shouldRefreshIndex: true,
            });

            expect(result.changeSet.changes.length).toBe(1);
            expect(result.changeSet.changes[0]!.kind).toBe('upsert');
            expect(result.articleRows[0]?.scrapeStatus).toBe('succeeded');
        });
    });

    describe('retrieval service', () => {
        let tmpDir: string;
        let store: CorpusStore;
        let mockAdapter: EmbeddingAdapter;
        let mockReporter: ProgressReporter;

        /** Builds a minimal CorpusSource for seeding the corpus store. */
        const makeSource = (id: string, type: SourceType = 'foundry'): CorpusSource => ({
            sourceId: `${type}:${id}`,
            sourceKey: id,
            sourceType: type,
            title: `Source ${id}`,
            status: 'succeeded',
            metadata: { sourceType: type },
        });

        /** Builds a single-chunk payload for the given source and text. */
        const makeChunk = (source: CorpusSource, text: string): CorpusChunk => ({
            chunkId: `${source.sourceId}:chunk:0`,
            chunkIndex: 0,
            sourceId: source.sourceId,
            text,
            citation: { label: source.title, locator: 'test', sourceType: source.sourceType, url: null },
            metadata: { sourceType: source.sourceType },
        });

        beforeEach(async () => {
            tmpDir = await mkdtemp(path.join(os.tmpdir(), 'eqa-retrieval-'));
            store = createCorpusStore();
            await store.initialize(tmpDir);

            // All embeddings are identical vectors so semantic scores are uniform
            // and test assertions can focus on matchKind rather than score ordering.
            mockAdapter = {
                embed: vi.fn((_input: string) => Promise.resolve([0.1, 0.2, 0.3])),
                embedBatch: vi.fn((inputs: string[]) => Promise.resolve(inputs.map(() => [0.1, 0.2, 0.3]))),
                modelId: 'test-model',
                schemaVersion: 'sqlite-json-v1',
            };
            mockReporter = { info: vi.fn(), warn: vi.fn() };
        });

        afterEach(async () => {
            store.close();
            await rm(tmpDir, { force: true, recursive: true });
        });

        it('refreshes retrieval embeddings and reuses compatible vectors', async () => {
            const source = makeSource('sharn-1');
            await store.replaceSource(tmpDir, source, [makeChunk(source, 'Sharn is a vertical city.')]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            const first = await service.refresh(tmpDir);
            expect(first.chunkCount).toBe(1);
            expect(first.regeneratedEmbeddings).toBe(1);
            expect(first.reusedEmbeddings).toBe(0);

            // Second pass: content hash unchanged, so the existing vector row is reused.
            const second = await service.refresh(tmpDir);
            expect(second.chunkCount).toBe(1);
            expect(second.reusedEmbeddings).toBe(1);
            expect(second.regeneratedEmbeddings).toBe(0);
        });

        it('re-embeds chunks whose content changed since the checkpoint was written', async () => {
            // Two chunks are embedded on the first pass. Then the first chunk's
            // vector row is manually deleted to simulate content-driven staleness
            // — the same scenario that occurs when source material is edited in an
            // area the checkpoint has already passed. The pre-checkpoint scan on
            // the second pass must detect and re-embed the stale chunk without
            // needing to iterate through all batches from scratch.
            const source = makeSource('sharn-1');
            const chunk0 = makeChunk(source, 'Sharn is a vertical city.');
            const chunk1 = makeChunk({ ...source, sourceId: `${source.sourceType}:sharn-2`, sourceKey: 'sharn-2' }, 'Breland is a kingdom.');
            await store.replaceSource(tmpDir, source, [chunk0]);
            await store.replaceSource(tmpDir, { ...source, sourceId: `${source.sourceType}:sharn-2`, sourceKey: 'sharn-2' }, [chunk1]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir);

            // Simulate a stale vector: delete one chunk's embedding from chunk_vectors,
            // as though the content changed between runs and the vector is now outdated.
            const Database = (await import('better-sqlite3')).default;
            const db = new Database(getCorpusDatabasePath(tmpDir));
            db.prepare('DELETE FROM chunk_vectors WHERE chunk_id = ?').run(chunk0.chunkId);
            db.close();

            const second = await service.refresh(tmpDir);
            expect(second.regeneratedEmbeddings).toBe(1);
            expect(second.reusedEmbeddings).toBe(1);
        });

        it('deletes the legacy vector-index sidecar during force rebuild', async () => {
            const source = makeSource('sharn-1');
            await store.replaceSource(tmpDir, source, [makeChunk(source, 'Sharn is a vertical city.')]);

            const legacyPath = getVectorIndexPath(tmpDir);
            await writeFile(legacyPath, '{}', 'utf8');

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir, { forceRebuild: true });

            // access throws ENOENT when the file is absent.
            await expect(access(legacyPath)).rejects.toThrow();
        });

        it('returns lexical results for plain-text search', async () => {
            const source = makeSource('sharn-1');
            await store.replaceSource(tmpDir, source, [makeChunk(source, 'Sharn is a vertical city of towers.')]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir);
            const results = await service.search({ query: 'sharn' });

            expect(results.length).toBeGreaterThan(0);
            expect(results.some(r => r.content.includes('Sharn'))).toBe(true);
        });

        it('merges lexical and semantic matches into hybrid-ranked results', async () => {
            const foundrySource = makeSource('sharn-1', 'foundry');
            const pdfSource = makeSource('breland-1', 'pdf');
            await store.replaceSource(tmpDir, foundrySource, [makeChunk(foundrySource, 'Sharn is a vertical city of towers.')]);
            await store.replaceSource(tmpDir, pdfSource, [makeChunk(pdfSource, 'Breland is a kingdom in Khorvaire.')]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir);
            // 'sharn' query: lexical matches only the Sharn chunk; vector scores both.
            // The Sharn chunk is merged into 'hybrid'; the Breland chunk stays 'vector'.
            const results = await service.search({ query: 'sharn' });

            expect(results.some(r => r.matchKind === 'hybrid')).toBe(true);
            expect(results.some(r => r.matchKind === 'vector')).toBe(true);
        });

        it('applies sourceType and sourceKey filters during search', async () => {
            const foundrySource = makeSource('sharn-1', 'foundry');
            const pdfSource = makeSource('sharn-pdf', 'pdf');
            await store.replaceSource(tmpDir, foundrySource, [makeChunk(foundrySource, 'Sharn is a vertical city of towers.')]);
            await store.replaceSource(tmpDir, pdfSource, [makeChunk(pdfSource, 'Sharn towers described in this PDF.')]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir);
            const results = await service.search({ query: 'sharn', sourceTypes: ['foundry'] });

            expect(results.length).toBeGreaterThan(0);
            expect(results.every(r => r.sourceType === 'foundry')).toBe(true);
        });

        it('returns no results for empty queries', async () => {
            const source = makeSource('sharn-1');
            await store.replaceSource(tmpDir, source, [makeChunk(source, 'Sharn is a vertical city.')]);

            const service = createCorpusRetrievalService({ embeddingAdapter: mockAdapter, reporter: mockReporter });
            await service.refresh(tmpDir);
            const results = await service.search({ query: '' });

            expect(results).toHaveLength(0);
        });

        it('disables in-memory vector caching for oversized corpus databases', async () => {
            const source = makeSource('sharn-1');
            await store.replaceSource(tmpDir, source, [makeChunk(source, 'Sharn is a vertical city of towers.')]);

            // maxVectorCacheDatabaseBytes: 1 forces the cache-bypass path for any
            // real corpus DB because the actual file will always exceed one byte.
            const service = createCorpusRetrievalService({
                embeddingAdapter: mockAdapter,
                maxVectorCacheDatabaseBytes: 1,
                reporter: mockReporter,
            });
            await service.refresh(tmpDir);
            await service.search({ query: 'sharn' });

            const infoMessages = (mockReporter.info as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
            expect(infoMessages.some(m => m.includes('vector cache disabled'))).toBe(true);
        });
    });

    describe('party context service', () => {
        let tmpDir: string;
        let store: CorpusStore;

        beforeEach(async () => {
            tmpDir = await mkdtemp(path.join(os.tmpdir(), 'eqa-party-'));
            store = createCorpusStore();
            await store.initialize(tmpDir);
        });

        afterEach(async () => {
            store.close();
            await rm(tmpDir, { force: true, recursive: true });
        });

        it('builds party context from configured actors session notes and quest journals', async () => {
            // EQA_PARTY_ACTOR_UUIDS is 'Actor.test' (from tests/setup.ts), so a
            // foundry source with sourceUuid='Actor.test' should appear in the output.
            const actorSource: CorpusSource = {
                sourceId: 'foundry:actor-test-001',
                sourceKey: 'actor-test',
                sourceType: 'foundry',
                title: 'Valros the Bold',
                status: 'succeeded',
                metadata: { sourceUuid: 'Actor.test', entityKind: 'Actor', sourceType: 'foundry' },
            };
            await store.replaceSource(tmpDir, actorSource, []);

            const service = createPartyContextService();
            const context = await service.build(tmpDir);

            expect(context).toContain('Valros the Bold');
        });

        it('returns explanatory party-context fallbacks when actor UUIDs are missing', async () => {
            // settingsStore().write updates the in-memory singleton directly.
            await settingsStore().write(appDb, 'partyActorUuids', []);
            try {
                const service = createPartyContextService();
                const context = await service.build(tmpDir);
                expect(context).toContain('Party actor UUIDs are not configured');
            } finally {
                await settingsStore().write(appDb, 'partyActorUuids', ['Actor.test']);
            }
        });

        it('returns explanatory party-context fallbacks when corpus.sqlite is absent', async () => {
            // Passing a directory that has never had a corpus store initialized
            // means corpus.sqlite does not exist.
            const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'eqa-empty-'));
            try {
                const service = createPartyContextService();
                const context = await service.build(emptyDir);
                expect(context).toContain('corpus.sqlite has not been created');
            } finally {
                await rm(emptyDir, { force: true, recursive: true });
            }
        });
    });
});
