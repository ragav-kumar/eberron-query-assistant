import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeSettingsStore, settingsStore } from '@server/db/app/index.js';
import { settingKeys } from '@server/db/app/settings/settingKeys.js';
import { loadLegacyMigrationConfig, migrateV1DiskToV2Db } from '@/server/migrate-v1-to-v2.js';

import { createInMemoryAppDb } from './support/app-db.js';

describe('migrateV1DiskToV2Db', () => {
    let appDb: Awaited<ReturnType<typeof createInMemoryAppDb>>;
    let repoRoot: string;

    beforeEach(async () => {
        appDb = await createInMemoryAppDb();
        repoRoot = await mkdtemp(path.join(os.tmpdir(), 'eqa-migration-'));
    });

    afterEach(async () => {
        await appDb.destroy();
        await rm(repoRoot, { force: true, recursive: true });
    });

    it('initializes default V2 settings when missing', async () => {
        const summary = await runMigrationScenario();

        expect(summary.envSettings).toBe(13);
        const articleIndexUrl = await readSetting(settingKeys.articleIndexUrl);
        const retrievalMaxToolTurns = await readSetting(settingKeys.retrievalMaxToolTurns);
        expect(articleIndexUrl).not.toBeNull();
        expect(retrievalMaxToolTurns).toBe('3');
    });

    it('parses persisted typed settings into in-memory settings', async () => {
        await runMigrationScenario({
            processEnv: {
                EQA_PARTY_ACTOR_UUIDS: 'actor-1, actor-2',
                EQA_PROVIDER_DEBUG: 'true',
            },
        });
        await initializeSettingsStore(appDb);

        expect(settingsStore().read('partyActorUuids')).toEqual(['actor-1', 'actor-2']);
        expect(settingsStore().read('consolePersist')).toBe(true);
    });

    it('serializes typed settings back to storage', async () => {
        await runMigrationScenario({
            processEnv: {
                EQA_PARTY_ACTOR_UUIDS: 'actor-1, actor-2',
                EQA_PROVIDER_DEBUG: 'true',
            },
        });

        expect(await readSetting(settingKeys.partyActorUuids)).toBe('["actor-1","actor-2"]');
        expect(await readSetting(settingKeys.consolePersist)).toBe('true');
    });

    it('migrates V1 session and transcript data that still matters to V2', async () => {
        await writeLegacyLog('20240506112233 Sharn Notes.json', [
            { kind: 'progress', message: 'Checking Sharn context.' },
            { assistant: 'Sharn is a vertical city.', kind: 'exchange', title: 'Sharn summary', user: 'What is Sharn?' },
        ]);

        await runMigrationScenario();

        const session = await appDb.db
            .selectFrom('sessions')
            .select(['id', 'mode', 'title'])
            .where('mode', '=', 'assistant')
            .executeTakeFirstOrThrow();
        const run = await appDb.db
            .selectFrom('runs')
            .select(['prompt', 'retrievalTurnLimit', 'sessionId'])
            .where('sessionId', '=', session.id)
            .executeTakeFirstOrThrow();
        const entries = await appDb.db
            .selectFrom('sessionEntries')
            .select(['kind', 'title'])
            .where('sessionId', '=', session.id)
            .orderBy('sequenceIndex', 'asc')
            .execute();

        expect(session.title).toBe('Sharn Notes');
        expect(run.prompt).toBe('What is Sharn?');
        expect(run.retrievalTurnLimit).toBe(1);
        expect(entries.map(entry => entry.kind)).toEqual(['user', 'reasoning', 'response']);
        expect(entries.at(-1)?.title).toBe('Sharn summary');
    });

    it('migrates NPC records needed by the V2 NPC workflow', async () => {
        await writeLegacyNpcJson([{
            bio: 'A Cannith fixer.',
            createdAt: '2024-05-06T10:00:00.000Z',
            description: 'Well-dressed and watchful.',
            id: 7,
            name: 'Kala d\'Cannith',
            role: 'artificer',
            species: 'human',
            updatedAt: '2024-05-06T11:00:00.000Z',
        }]);

        await runMigrationScenario();

        const npc = await appDb.db
            .selectFrom('npcs')
            .select(['id', 'name', 'role', 'species'])
            .executeTakeFirstOrThrow();
        const npcSession = await appDb.db
            .selectFrom('sessions')
            .select(['mode', 'title'])
            .where('mode', '=', 'npc')
            .executeTakeFirstOrThrow();

        expect(npc).toMatchObject({
            id: 7,
            name: 'Kala d\'Cannith',
            role: 'artificer',
            species: 'human',
        });
        expect(npcSession.title).toBe('Legacy NPC Imports');
    });

    it('preserves includePartyContext defaults across migration', async () => {
        await writeLegacyLog('20240506112233 Sharn Notes.json', [
            { assistant: 'Answer', kind: 'exchange', title: 'Summary', user: 'Question' },
        ]);
        await writeLegacyNpcJson([{
            bio: 'A fixer.',
            createdAt: '2024-05-06T10:00:00.000Z',
            description: 'Watchful.',
            id: 1,
            name: 'Kala',
            updatedAt: '2024-05-06T11:00:00.000Z',
        }]);

        await runMigrationScenario();

        const sessionFlags = await appDb.db.selectFrom('sessions').select('includePartyContext').execute();
        const runFlags = await appDb.db.selectFrom('runs').select('includePartyContext').execute();

        expect(sessionFlags.every(row => row.includePartyContext === 1)).toBe(true);
        expect(runFlags.every(row => row.includePartyContext === 1)).toBe(true);
    });

    it('leaves activeRunId cleared after migration', async () => {
        await writeLegacyLog('20240506112233 Sharn Notes.json', [
            { assistant: 'Answer', kind: 'exchange', title: 'Summary', user: 'Question' },
        ]);

        await runMigrationScenario();

        const activeRunIds = await appDb.db.selectFrom('sessions').select('activeRunId').execute();
        expect(activeRunIds.every(row => row.activeRunId === null)).toBe(true);
    });

    it('migrates NPC records from legacy markdown log format', async () => {
        await writeLegacyNpcMarkdown([
            '### 9. Seren Guide',
            '',
            'Description: Lean dragonmarked traveler.',
            '',
            'Bio: A guide with a talent for reading the wilds.',
            '',
        ].join('\n'));

        await runMigrationScenario();

        const npc = await appDb.db
            .selectFrom('npcs')
            .select(['id', 'name', 'description', 'bio'])
            .executeTakeFirstOrThrow();

        expect(npc).toMatchObject({
            id: 9,
            name: 'Seren Guide',
            description: 'Lean dragonmarked traveler.',
            bio: 'A guide with a talent for reading the wilds.',
        });
    });

    const runMigrationScenario = async (options: {
        additionalContext?: string;
        env?: string;
        processEnv?: Partial<Record<'EQA_PARTY_ACTOR_UUIDS' | 'EQA_PROVIDER_DEBUG', string>>;
    } = {}) => {
        if (options.additionalContext !== undefined) {
            await writeRepoFile('assistant/additional-context.md', options.additionalContext);
        }
        if (options.env !== undefined) {
            await writeRepoFile('.env', options.env);
        }

        const originalEnv = new Map<string, string | undefined>();
        for (const [key, value] of Object.entries(options.processEnv ?? {})) {
            originalEnv.set(key, process.env[key]);
            process.env[key] = value;
        }

        try {
            const summary = await migrateV1DiskToV2Db(loadLegacyMigrationConfig(repoRoot), appDb);
            await initializeSettingsStore(appDb);
            return summary;
        } finally {
            for (const [key, value] of originalEnv.entries()) {
                if (value === undefined) {
                    delete process.env[key];
                    continue;
                }
                process.env[key] = value;
            }
        }
    };

    const writeLegacyLog = async (filename: string, entries: unknown[]) => {
        await writeRepoFile(path.join('logs', filename), `${JSON.stringify(entries, null, 2)}\n`);
    };

    const writeLegacyNpcJson = async (rows: unknown[]) => {
        await writeRepoFile('.eberron-query-assistant/state/generated-npcs.json', `${JSON.stringify(rows, null, 2)}\n`);
    };

    const writeLegacyNpcMarkdown = async (markdown: string) => {
        await writeRepoFile('logs/generated_npcs.md', markdown);
    };

    const writeRepoFile = async (relativePath: string, contents: string) => {
        const absolutePath = path.join(repoRoot, relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, contents, 'utf8');
    };

    const readSetting = async (key: string) => {
        const row = await appDb.db
            .selectFrom('settings')
            .select('value')
            .where('key', '=', key)
            .executeTakeFirst();
        return row?.value ?? null;
    };
});
