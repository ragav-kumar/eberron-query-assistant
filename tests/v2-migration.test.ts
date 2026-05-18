import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createAppDb, getAppDatabasePath } from '@/server/v2/db-app/index.js';
import { settingKeys } from '@/server/v2/db-app/settingKeys.js';
import { migrateV1DiskToV2Db } from '@/server/migrate-v1-to-v2.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-migration');
const ENV_KEYS = [
    'EQA_CAMPAIGN_JOURNAL_FOLDER',
    'EQA_PARTY_ACTOR_UUIDS',
    'EQA_PROVIDER_DEBUG',
    'EQA_QUESTS_JOURNAL',
    'EQA_SESSION_NOTES_JOURNAL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_CHAT_MODEL',
    'OPENAI_EMBEDDING_MODEL',
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

describe('migrateV1DiskToV2Db', () => {
    beforeEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
    });

    afterEach(async () => {
        for (const key of ENV_KEYS) {
            const original = originalEnv[key];
            if (original === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = original;
            }
        }
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    it('migrates env-backed settings, runtime state, NPCs, and legacy logs with warnings and rerun stability', async () => {
        await seedMigrationRepo();
        const config = loadDefaultConfig(TEST_ROOT);
        const appDb = await createAppDb(getAppDatabasePath(config.runtimeDir));
        const messages: string[] = [];

        try {
            const firstSummary = await migrateV1DiskToV2Db(config, appDb, {
                info: message => {
                    messages.push(`info:${message}`);
                },
                warn: message => {
                    messages.push(`warn:${message}`);
                },
            });

            expect(firstSummary).toMatchObject({
                articles: 2,
                envSettings: 9,
                foundryFiles: 2,
                logRuns: 2,
                logSessionEntries: 6,
                logSessions: 1,
                npcRows: 2,
                pdfFiles: 2,
                singletonSettings: 1,
                warnings: 1,
            });
            expect(messages.some(message => message.includes('Skipping invalid legacy exchange entry'))).toBe(true);

            const settings = await appDb.db
                .selectFrom('settings')
                .selectAll()
                .orderBy('key', 'asc')
                .execute();
            expect(settings).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    key: settingKeys.additionalContext,
                    value: '# Imported context',
                }),
                expect.objectContaining({
                    key: settingKeys.providerApiKey,
                    value: 'sk-migration-test',
                }),
                expect.objectContaining({
                    key: settingKeys.providerDebug,
                    value: 'true',
                }),
                expect.objectContaining({
                    key: settingKeys.partyActorUuids,
                    value: JSON.stringify(['Actor.one', 'Actor.two']),
                }),
                expect.objectContaining({
                    key: settingKeys.foundryLastSuccessfulExportFilename,
                    value: '20260508T002826089Z-foundry-export.ndjson',
                }),
                expect.objectContaining({
                    key: settingKeys.articleLastSuccessfulIndexScrapeAt,
                    value: '2026-05-16T17:07:53.759Z',
                }),
            ]));
            expect(settings.some(setting => setting.key.includes('app-version'))).toBe(false);

            await expect(appDb.db
                .selectFrom('ingestedFiles')
                .selectAll()
                .orderBy('sourceType', 'asc')
                .orderBy('filename', 'asc')
                .execute()).resolves.toEqual([
                { filename: '20260508T002826089Z-foundry-export.ndjson', sourceType: 'foundry' },
                { filename: '20260509T002826089Z-foundry-export.ndjson', sourceType: 'foundry' },
                { filename: 'a.pdf', sourceType: 'pdf' },
                { filename: 'b.pdf', sourceType: 'pdf' },
            ]);

            await expect(appDb.db
                .selectFrom('ingestedArticles')
                .selectAll()
                .orderBy('canonicalUrl', 'asc')
                .execute()).resolves.toEqual([
                {
                    canonicalUrl: 'https://keith-baker.com/article-a/',
                    firstSeenAt: '2026-04-30T18:49:38.824Z',
                    lastIngestedAt: '2026-05-08T02:42:22.226Z',
                    scrapeStatus: 'succeeded',
                    title: 'Article A',
                },
                {
                    canonicalUrl: 'https://keith-baker.com/article-b/',
                    firstSeenAt: '2026-04-30T18:49:38.824Z',
                    lastIngestedAt: null,
                    scrapeStatus: 'inaccessible',
                    title: null,
                },
            ]);

            const sessions = await appDb.db
                .selectFrom('sessions')
                .selectAll()
                .orderBy('id', 'asc')
                .execute();
            expect(sessions).toHaveLength(2);
            expect(sessions).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: 'legacy-v1-npc-session',
                    mode: 'npc',
                    title: 'Legacy NPC Imports',
                }),
                expect.objectContaining({
                    mode: 'assistant',
                    title: 'Legacy Session',
                    createdAt: new Date(2026, 4, 9, 11, 25, 55).toISOString(),
                }),
            ]));

            await expect(appDb.db
                .selectFrom('runs')
                .selectAll()
                .orderBy('id', 'asc')
                .execute()).resolves.toEqual(expect.arrayContaining([
                expect.objectContaining({
                    id: 'legacy-v1-npc-run',
                    mode: 'npc',
                }),
                expect.objectContaining({
                    mode: 'assistant',
                    prompt: 'Legacy question',
                    retrievalTurnLimit: 1,
                }),
                expect.objectContaining({
                    mode: 'assistant',
                    prompt: 'Typed question',
                    retrievalTurnLimit: 1,
                }),
            ]));

            const sessionEntries = await appDb.db
                .selectFrom('sessionEntries')
                .selectAll()
                .orderBy('createdAt', 'asc')
                .execute();
            expect(sessionEntries).toHaveLength(6);
            expect(sessionEntries.map(entry => entry.kind)).toEqual([
                'user',
                'reasoning',
                'response',
                'user',
                'reasoning',
                'response',
            ]);

            const npcs = await appDb.db
                .selectFrom('npcs')
                .selectAll()
                .orderBy('id', 'asc')
                .execute();
            expect(npcs).toEqual([
                expect.objectContaining({
                    id: 1,
                    name: 'One',
                    runId: 'legacy-v1-npc-run',
                    sessionId: 'legacy-v1-npc-session',
                }),
                expect.objectContaining({
                    id: 2,
                    name: 'Two',
                    runId: 'legacy-v1-npc-run',
                    sessionId: 'legacy-v1-npc-session',
                }),
            ]);

            messages.length = 0;
            const secondSummary = await migrateV1DiskToV2Db(config, appDb, {
                info: message => {
                    messages.push(`info:${message}`);
                },
                warn: message => {
                    messages.push(`warn:${message}`);
                },
            });

            expect(secondSummary).toEqual(firstSummary);
            const sessionCount = await appDb.db
                .selectFrom('sessions')
                .select(ctx => ctx.fn.countAll().as('count'))
                .executeTakeFirstOrThrow();
            const runCount = await appDb.db
                .selectFrom('runs')
                .select(ctx => ctx.fn.countAll().as('count'))
                .executeTakeFirstOrThrow();
            const sessionEntryCount = await appDb.db
                .selectFrom('sessionEntries')
                .select(ctx => ctx.fn.countAll().as('count'))
                .executeTakeFirstOrThrow();

            expect(Number(sessionCount.count)).toBe(2);
            expect(Number(runCount.count)).toBe(3);
            expect(Number(sessionEntryCount.count)).toBe(6);
        } finally {
            await appDb.close();
        }
    });

});

const seedMigrationRepo = async (): Promise<void> => {
    await mkdir(path.join(TEST_ROOT, 'assistant'), { recursive: true });
    await mkdir(path.join(TEST_ROOT, 'logs'), { recursive: true });
    await mkdir(path.join(TEST_ROOT, '.eberron-query-assistant', 'state'), { recursive: true });

    await writeFile(path.join(TEST_ROOT, '.env'), [
        'OPENAI_API_KEY=sk-migration-test',
        'OPENAI_BASE_URL=https://provider.example/v1/',
        'OPENAI_CHAT_MODEL=gpt-migration-chat',
        'OPENAI_EMBEDDING_MODEL=text-embedding-migration',
        'EQA_PROVIDER_DEBUG=true',
        'EQA_PARTY_ACTOR_UUIDS=Actor.one, Actor.two',
        'EQA_SESSION_NOTES_JOURNAL=Minutes',
        'EQA_QUESTS_JOURNAL=Leads',
        'EQA_CAMPAIGN_JOURNAL_FOLDER=Campaign',
    ].join('\n'), 'utf8');

    await writeFile(path.join(TEST_ROOT, 'assistant', 'additional-context.md'), '# Imported context', 'utf8');

    await writeFile(path.join(TEST_ROOT, '.eberron-query-assistant', 'state', 'runtime-state.json'), JSON.stringify({
        appVersion: '0.11.0',
        foundry: {
            appliedExportFilenames: [
                '20260508T002826089Z-foundry-export.ndjson',
                '20260509T002826089Z-foundry-export.ndjson',
            ],
            lastSuccessfulExport: {
                deleteCount: 0,
                filename: '20260508T002826089Z-foundry-export.ndjson',
                generatedAt: '2026-05-08T00:28:26.089Z',
                recordCount: 36709,
                runId: 'runtime-1778200106089',
                schemaVersion: '2.0.0',
                upsertCount: 36709,
            },
        },
        pdf: {
            knownFilenames: ['a.pdf', 'b.pdf'],
        },
        article: {
            lastSuccessfulIndexScrapeAt: '2026-05-16T17:07:53.759Z',
            knownArticles: [
                {
                    canonicalUrl: 'https://keith-baker.com/article-a/',
                    title: 'Article A',
                    firstSeenAt: '2026-04-30T18:49:38.824Z',
                    lastIngestedAt: '2026-05-08T02:42:22.226Z',
                    scrapeStatus: 'succeeded',
                },
                {
                    canonicalUrl: 'https://keith-baker.com/article-b/',
                    title: null,
                    firstSeenAt: '2026-04-30T18:49:38.824Z',
                    lastIngestedAt: null,
                    scrapeStatus: 'inaccessible',
                },
            ],
        },
    }, null, 2), 'utf8');

    await writeFile(path.join(TEST_ROOT, '.eberron-query-assistant', 'state', 'generated-npcs.json'), JSON.stringify([
        {
            id: 1,
            name: 'One',
            description: 'First NPC',
            bio: 'Bio one',
            createdAt: '2026-05-03T04:13:08.146Z',
            updatedAt: '2026-05-03T04:13:08.146Z',
        },
        {
            id: 2,
            name: 'Two',
            description: 'Second NPC',
            bio: 'Bio two',
            role: 'Guide',
            createdAt: '2026-05-04T04:13:08.146Z',
            updatedAt: '2026-05-05T04:13:08.146Z',
        },
    ], null, 2), 'utf8');

    await writeFile(path.join(TEST_ROOT, 'logs', '20260509112555 Legacy Session.json'), JSON.stringify([
        {
            kind: 'progress',
            message: 'Looking something up.',
        },
        {
            user: 'Legacy question',
            assistant: 'Legacy answer',
            title: 'Legacy title',
        },
        {
            kind: 'progress',
            message: 'Second lookup.',
        },
        {
            kind: 'exchange',
            user: 'Typed question',
            assistant: 'Typed answer',
            title: 'Typed title',
        },
        {
            user: 'Missing assistant',
            title: 'Broken entry',
        },
    ], null, 2), 'utf8');
};
