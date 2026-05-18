import Database from 'better-sqlite3';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import type { EmbeddingAdapter } from '@/server/v1/provider/index.js';
import {
    createCorpusRetrievalService,
    createCorpusStore,
    createPartyContextService,
    getCorpusDatabasePath,
} from '@/server/v2/corpus/index.js';
import type { CorpusChunk, CorpusSource, RuntimeConfig } from '@/types.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-corpus');
const stores: Array<ReturnType<typeof createCorpusStore>> = [];

afterEach(async () => {
    for (const store of stores.splice(0)) {
        store.close();
    }
    await rm(TEST_ROOT, { force: true, recursive: true });
});

describe('v2 corpus boundary', () => {
    it('initializes the corpus schema', async () => {
        const config = loadDefaultConfig(path.join(TEST_ROOT, 'schema'));
        const store = createStore();

        await store.initialize(config);

        expect(readTableNames(config)).toEqual(
            expect.arrayContaining(['chunks', 'chunks_fts', 'chunks_fts_config', 'chunks_fts_data', 'chunks_fts_docsize', 'chunks_fts_idx', 'sources']),
        );
    });

    it('rejects incompatible schema unless reset is explicitly allowed', async () => {
        const config = loadDefaultConfig(path.join(TEST_ROOT, 'compatibility'));
        await mkdir(config.retrievalDir, { recursive: true });
        const database = new Database(getCorpusDatabasePath(config));
        database.exec('CREATE TABLE sources (source_id TEXT PRIMARY KEY, title TEXT NOT NULL)');
        database.close();

        const strictStore = createStore();
        await expect(strictStore.initialize(config)).rejects.toMatchObject({ kind: 'incompatible-corpus-schema' });
        strictStore.close();

        const resetStore = createStore();
        await expect(resetStore.initialize(config, { allowIncompatibleReset: true })).resolves.toBeUndefined();
        expect(readTableNames(config)).toContain('chunks');
    });

    it('supports write-side source replacement, removal, counting, and lexical retrieval', async () => {
        const config = loadDefaultConfig(path.join(TEST_ROOT, 'writes'));
        const store = createStore();
        await store.initialize(config);

        await store.replaceSource(config, source('pdf', 'eberron.pdf', 'Eberron Rising'), [
            chunk('pdf:eberron.pdf:0', 'pdf:eberron.pdf', 0, 'Aerenal keeps deathless counselors.', 'Eberron Rising', 'page 4'),
        ]);
        await store.replaceSource(config, source('article', 'https://keith-baker.com/trust/', 'Trust Notes'), [
            chunk(
                'article:https://keith-baker.com/trust/:0',
                'article:https://keith-baker.com/trust/',
                0,
                'The Trust watches Zilargo carefully.',
                'Trust Notes',
                null,
                'https://keith-baker.com/trust/',
            ),
        ]);

        expect(await store.countSources(config)).toBe(2);

        const retrieval = createCorpusRetrievalService({
            embeddingAdapter: keywordEmbeddingAdapter('aerenal', 'trust'),
            reporter: createSilentReporter(),
        });
        await retrieval.refresh(config);
        const results = await retrieval.search({ limit: 5, query: 'deathless aerenal' });

        expect(results[0]?.sourceKey).toBe('eberron.pdf');
        expect(results[0]?.matchKind).toBe('hybrid');

        await store.removeSource(config, 'pdf', 'eberron.pdf');
        expect(await store.countSources(config)).toBe(1);

        await retrieval.refresh(config);
        await expect(retrieval.search({ limit: 5, query: 'deathless aerenal' })).resolves.toEqual([]);
    });

    it('creates and reuses SQLite vector rows during refresh', async () => {
        const config = loadDefaultConfig(path.join(TEST_ROOT, 'vectors'));
        const store = createStore();
        await store.initialize(config);
        await store.replaceSource(config, source('pdf', 'eberron.pdf', 'Eberron Rising'), [
            chunk('pdf:eberron.pdf:0', 'pdf:eberron.pdf', 0, 'Aerenal keeps deathless counselors.', 'Eberron Rising', 'page 4'),
            chunk('pdf:eberron.pdf:1', 'pdf:eberron.pdf', 1, 'Mror dwarves study the Holds.', 'Eberron Rising', 'page 5'),
        ]);

        const adapter = countingEmbeddingAdapter();
        const retrieval = createCorpusRetrievalService({
            embeddingAdapter: adapter,
            reporter: createSilentReporter(),
        });

        const first = await retrieval.refresh(config);
        const second = await retrieval.refresh(config);

        expect(first).toMatchObject({ chunkCount: 2, regeneratedEmbeddings: 2, reusedEmbeddings: 0 });
        expect(second).toMatchObject({ chunkCount: 2, regeneratedEmbeddings: 0, reusedEmbeddings: 2 });
        expect(adapter.embedBatch).toHaveBeenCalledTimes(1);
        expect(readRows(config, 'SELECT key, value FROM retrieval_metadata')).toEqual([
            { key: 'vector_store_schema_version', value: 'sqlite-json-v1' },
        ]);
        expect(readRows(config, 'SELECT chunk_id FROM chunk_vectors ORDER BY chunk_id')).toEqual([
            { chunk_id: 'pdf:eberron.pdf:0' },
            { chunk_id: 'pdf:eberron.pdf:1' },
        ]);
    });

    it('builds party context from foundry corpus rows', async () => {
        const config = loadDefaultConfig(path.join(TEST_ROOT, 'party-context'));
        config.campaign.partyActorUuids = ['Actor.peanunt'];
        config.campaign.sessionNotesJournal = 'Session Notes';
        config.campaign.questsJournal = 'Quests';
        config.campaign.campaignJournalFolder = 'Legacy';

        const store = createStore();
        await store.initialize(config);
        await store.replaceSourcesByType(config, 'foundry', [
            foundrySource('foundry:peanunt', 'world.actor.peanunt', 'Peanunt', 'Actor.peanunt', 'Actor', [], 'Peanunt keeps a hidden notebook.'),
            foundrySource(
                'foundry:session',
                'world.journalentrypage.session.new',
                '2026-04-25',
                'JournalEntry.session.JournalEntryPage.new',
                'JournalEntryPage',
                ['Session Notes', '2026-04-25'],
                'The party reached Vathirond.',
                '2026-04-25T00:00:00.000Z',
            ),
            foundrySource(
                'foundry:quests',
                'world.journalentrypage.quests.main',
                'Main Quests',
                'JournalEntry.quests.JournalEntryPage.main',
                'JournalEntryPage',
                ['Quests', 'Main Quests'],
                'Investigate trouble near Vathirond.',
            ),
        ]);

        const context = await createPartyContextService().build(config);

        expect(context).toContain('Current party context:');
        expect(context).toContain('Peanunt');
        expect(context).toContain('2026-04-25');
        expect(context).toContain('Main Quests');
        expect(context).toContain('Foundry export freshness: 2026-05-02T20:09:43.241Z');
    });

    it('returns party-context fallback messages for missing corpus and missing actors', async () => {
        const missingCorpusConfig = loadDefaultConfig(path.join(TEST_ROOT, 'party-fallback-missing-db'));
        missingCorpusConfig.campaign.partyActorUuids = ['Actor.peanunt'];
        await expect(createPartyContextService().build(missingCorpusConfig)).resolves.toContain(
            'Party context unavailable: corpus.sqlite has not been created.',
        );

        const missingActorConfig = loadDefaultConfig(path.join(TEST_ROOT, 'party-fallback-missing-actor'));
        missingActorConfig.campaign.partyActorUuids = ['Actor.missing'];
        missingActorConfig.campaign.sessionNotesJournal = 'Missing Notes';
        missingActorConfig.campaign.questsJournal = 'Missing Quests';

        const store = createStore();
        await store.initialize(missingActorConfig);
        await store.replaceSourcesByType(missingActorConfig, 'foundry', [
            foundrySource('foundry:other', 'world.actor.other', 'Other', 'Actor.other', 'Actor', [], 'Other actor.'),
        ]);

        const context = await createPartyContextService().build(missingActorConfig);
        expect(context).toContain('No configured party actors were found');
        expect(context).toContain('Missing configured actor UUIDs: Actor.missing');
        expect(context).toContain('No pages found for journal "Missing Notes"');
        expect(context).toContain('No pages found for journal "Missing Quests"');
    });
});

const createStore = () => {
    const store = createCorpusStore();
    stores.push(store);
    return store;
};

const source = (sourceType: CorpusSource['sourceType'], sourceKey: string, title: string): CorpusSource => ({
    metadata: {},
    sourceId: `${sourceType}:${sourceKey}`,
    sourceKey,
    sourceType,
    status: 'succeeded',
    title,
});

const chunk = (
    chunkId: string,
    sourceId: string,
    chunkIndex: number,
    text: string,
    label: string,
    locator: string | null,
    url: string | null = null,
): CorpusChunk => ({
    chunkId,
    chunkIndex,
    metadata: {},
    sourceId,
    text,
    citation: {
        label,
        locator,
        sourceType: sourceId.split(':', 1)[0] as CorpusChunk['citation']['sourceType'],
        url,
    },
});

const foundrySource = (
    sourceId: string,
    sourceKey: string,
    title: string,
    sourceUuid: string,
    entityKind: string,
    provenancePath: string[],
    text: string,
    modifiedTime: string | null = null,
): { chunks: CorpusChunk[]; source: CorpusSource } => {
    const metadata = {
        citationAnchor: provenancePath.length > 0 ? provenancePath.join(' > ') : sourceUuid,
        classificationTags: entityKind === 'Actor' ? ['subtype:character'] : ['page-type:text'],
        entityKind,
        exportGeneratedAt: '2026-05-02T20:09:43.241Z',
        exportRunId: 'run-1',
        modifiedTime,
        provenancePath,
        recordId: sourceKey,
        sourceScope: 'world',
        sourceType: 'foundry',
        sourceUuid,
        title,
    };

    return {
        chunks: [
            {
                chunkId: `${sourceId}:chunk:0`,
                chunkIndex: 0,
                metadata,
                sourceId,
                text,
                citation: {
                    label: title,
                    locator: metadata.citationAnchor,
                    sourceType: 'foundry',
                    url: null,
                },
            },
        ],
        source: {
            metadata,
            sourceId,
            sourceKey,
            sourceType: 'foundry',
            status: 'succeeded',
            title,
        },
    };
};

const createSilentReporter = () => ({
    info: () => undefined,
    warn: () => undefined,
});

const keywordEmbeddingAdapter = (...keywords: string[]): EmbeddingAdapter => {
    const embedKeywordVector = (input: string): number[] => {
        const lower = input.toLowerCase();
        const vector = keywords.map(keyword => (lower.includes(keyword) ? 1 : 0));
        return vector.some(value => value > 0) ? vector : keywords.map(() => 0);
    };

    return {
        embed: (input) => Promise.resolve(embedKeywordVector(input)),
        embedBatch: (inputs) => Promise.resolve(inputs.map(embedKeywordVector)),
        failedRetries: 0,
        modelId: `keyword-${keywords.join('-')}`,
        schemaVersion: 'keyword-v1',
    };
};

const countingEmbeddingAdapter = (): EmbeddingAdapter & { embedBatch: ReturnType<typeof vi.fn> } => {
    const base = keywordEmbeddingAdapter('aerenal', 'mror');
    return {
        ...base,
        embedBatch: vi.fn((inputs: string[]) => base.embedBatch(inputs)),
    };
};

const readTableNames = (config: RuntimeConfig): string[] => readRows(
    config,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
).map(row => String(row.name));

const readRows = (config: RuntimeConfig, sql: string): Array<Record<string, unknown>> => {
    const database = new Database(getCorpusDatabasePath(config), { readonly: true });
    try {
        return database.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
        database.close();
    }
};
