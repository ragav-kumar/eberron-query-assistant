import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createV2Orm, getAppDatabasePath } from '@/server/v2/db/index.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-orm');

describe('V2 ORM', () => {
    beforeEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    afterEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    it('creates a new app.sqlite with the v2 schema tables', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);

        try {
            await orm.bootstrap();

            const database = new Database(getAppDatabasePath(config), { readonly: true });
            try {
                const tableNames = database
                    .prepare(`
                        SELECT name
                        FROM sqlite_master
                        WHERE type = 'table'
                        ORDER BY name
                    `)
                    .all()
                    .map((row) => (row as { name: string }).name);

                expect(tableNames).toEqual([
                    'npcs',
                    'run_audit_logs',
                    'runs',
                    'session_entries',
                    'sessions',
                    'settings',
                ]);
            } finally {
                database.close();
            }
        } finally {
            orm.close();
        }
    });

    it('inserts and reads each schema shape successfully', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);
        const setting = createSetting();
        const session = createSession();
        const run = createRun();
        const entry = createUserEntry();
        const auditLog = createRunAuditLog();
        const npc = createNpc();

        try {
            await orm.bootstrap();
            await orm.settings.save(setting);
            await orm.sessions.save(session);
            await orm.runs.save(run);
            await orm.sessionEntries.save(entry);
            await orm.runAuditLogs.save(auditLog);
            await orm.npcs.save(npc);

            await expect(orm.settings.get(setting.key)).resolves.toMatchObject({
                key: setting.key,
                value: setting.value,
            });
            await expect(orm.sessions.get(session.id)).resolves.toMatchObject({
                id: session.id,
                kind: session.kind,
            });
            await expect(orm.runs.get(run.id)).resolves.toMatchObject({
                id: run.id,
                prompt: run.prompt,
            });
            await expect(orm.sessionEntries.get(entry.sessionId, entry.entryIndex)).resolves.toMatchObject({
                kind: 'user',
                content: entry.content,
            });
            await expect(orm.runAuditLogs.get(auditLog.id)).resolves.toMatchObject({
                id: auditLog.id,
                kind: auditLog.kind,
            });
            await expect(orm.npcs.get(npc.id)).resolves.toMatchObject({
                id: npc.id,
                name: npc.name,
            });
        } finally {
            orm.close();
        }
    });

    it('loads a session with ordered entries and a resolved active run', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);
        const session = {
            ...createSession(),
            activeRunId: 'run-1',
        };
        const run = createRun();

        try {
            await orm.sessions.save({
                ...session,
                activeRunId: null,
            });
            await orm.runs.save(run);
            await orm.sessions.save(session);
            await orm.sessionEntries.save({
                sessionId: session.id,
                entryIndex: 2,
                runId: run.id,
                title: 'Assistant reply',
                kind: 'assistant-response',
                content: 'Second entry',
                createdAt: new Date('2026-05-14T12:02:00.000Z'),
            });
            await orm.sessionEntries.save({
                sessionId: session.id,
                entryIndex: 1,
                runId: null,
                title: 'User prompt',
                kind: 'user',
                content: 'First entry',
                createdAt: new Date('2026-05-14T12:01:00.000Z'),
            });

            const loaded = await orm.sessions.get(session.id);

            expect(loaded).toMatchObject({
                id: session.id,
                activeRunId: run.id,
                activeRun: {
                    id: run.id,
                    prompt: run.prompt,
                },
            });
            expect(loaded?.entries.map((entryItem) => entryItem.entryIndex)).toEqual([1, 2]);
            expect(loaded?.entries[0]).toMatchObject({
                kind: 'user',
                content: 'First entry',
            });
        } finally {
            orm.close();
        }
    });

    it('loads a run with optional audit logs', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);
        const session = createSession();
        const run = createRun();
        const firstAuditLog = createRunAuditLog();
        const secondAuditLog = {
            ...createRunAuditLog(),
            id: 'audit-2',
            createdAt: new Date('2026-05-14T12:04:00.000Z'),
            details: 'Second audit entry',
        };

        try {
            await orm.sessions.save(session);
            await orm.runs.save(run);
            await orm.runAuditLogs.save(firstAuditLog);
            await orm.runAuditLogs.save(secondAuditLog);

            const withoutAuditLogs = await orm.runs.get(run.id);
            const withAuditLogs = await orm.runs.get(run.id, { includeAuditLogs: true });

            expect(withoutAuditLogs?.auditLogs).toBeUndefined();
            expect(withAuditLogs?.auditLogs).toHaveLength(2);
            expect(withAuditLogs?.auditLogs?.[0]).toMatchObject({
                id: firstAuditLog.id,
            });
            expect(withAuditLogs?.auditLogs?.[1]).toMatchObject({
                id: secondAuditLog.id,
            });
        } finally {
            orm.close();
        }
    });

    it('loads an assistant-npc session entry with resolved NPCs', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);
        const session = {
            ...createSession(),
            activeRunId: 'run-1',
        };
        const run = createRun();
        const firstNpc = createNpc();
        const secondNpc = {
            ...createNpc(),
            id: 2,
            name: 'Tavin',
        };

        try {
            await orm.sessions.save({
                ...session,
                activeRunId: null,
            });
            await orm.runs.save(run);
            await orm.sessions.save(session);
            await orm.npcs.save(firstNpc);
            await orm.npcs.save(secondNpc);
            await orm.sessionEntries.save({
                sessionId: session.id,
                entryIndex: 1,
                runId: run.id,
                title: 'NPC output',
                kind: 'assistant-npc',
                npcs: [],
                createdAt: new Date('2026-05-14T12:05:00.000Z'),
            });

            const entry = await orm.sessionEntries.get(session.id, 1);

            expect(entry).toMatchObject({
                kind: 'assistant-npc',
            });
            if (!entry || entry.kind !== 'assistant-npc') {
                throw new Error('Expected assistant-npc entry.');
            }
            expect(entry.npcs.map((npc) => npc.name)).toEqual(['Ilyra', 'Tavin']);
        } finally {
            orm.close();
        }
    });

    it('preserves nullable date and foreign-key fields correctly', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createV2Orm(config);
        const session = createSession();
        const run = createRun();

        try {
            await orm.sessions.save(session);
            await orm.runs.save({
                ...run,
                completedAt: null,
                failedAt: null,
                startedAt: null,
            });
            await orm.sessionEntries.save({
                sessionId: session.id,
                entryIndex: 1,
                runId: null,
                kind: 'system',
                content: 'System entry',
                createdAt: new Date('2026-05-14T12:06:00.000Z'),
            });

            const loadedSession = await orm.sessions.get(session.id);
            const loadedRun = await orm.runs.get(run.id);
            const loadedEntry = await orm.sessionEntries.get(session.id, 1);

            expect(loadedSession?.activeRunId).toBeNull();
            expect(loadedSession?.archivedAt).toBeNull();
            expect(loadedSession?.lastEntryAt).toBeNull();
            expect(loadedRun?.startedAt).toBeNull();
            expect(loadedRun?.completedAt).toBeNull();
            expect(loadedRun?.failedAt).toBeNull();
            expect(loadedEntry?.runId).toBeNull();
        } finally {
            orm.close();
        }
    });
});

const createSetting = () => {
    return {
        key: 'additionalContext',
        modifiedAt: new Date('2026-05-14T12:00:00.000Z'),
        value: 'Keep the tone grounded.',
    };
};

const createSession = () => {
    return {
        id: 'session-1',
        kind: 'assistant' as const,
        title: 'Session One',
        activeRunId: null,
        archivedAt: null,
        lastEntryAt: null,
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        updatedAt: new Date('2026-05-14T12:00:00.000Z'),
        entries: [],
    };
};

const createRun = () => {
    return {
        id: 'run-1',
        sessionId: 'session-1',
        includePartyContext: true,
        prompt: 'Draft a scene.',
        retrievalTurnLimit: 2,
        kind: 'assistant' as const,
        status: 'running' as const,
        createdAt: new Date('2026-05-14T12:01:00.000Z'),
        updatedAt: new Date('2026-05-14T12:01:00.000Z'),
        startedAt: new Date('2026-05-14T12:01:05.000Z'),
        completedAt: null,
        failedAt: null,
    };
};

const createUserEntry = () => {
    return {
        sessionId: 'session-1',
        entryIndex: 1,
        runId: null,
        title: 'Prompt',
        kind: 'user' as const,
        content: 'Tell me about Sharn.',
        createdAt: new Date('2026-05-14T12:02:00.000Z'),
    };
};

const createRunAuditLog = () => {
    return {
        id: 'audit-1',
        runId: 'run-1',
        kind: 'provider-request',
        details: 'Sent provider request.',
        createdAt: new Date('2026-05-14T12:03:00.000Z'),
    };
};

const createNpc = () => {
    return {
        id: 1,
        sessionId: 'session-1',
        runId: 'run-1',
        name: 'Ilyra',
        bio: 'A quiet scout from Aundair.',
        description: 'Lean half-elf with a weather-worn cloak.',
        age: '30s',
        ethnicity: 'Aundairian',
        gender: 'Woman',
        role: 'Scout',
        species: 'Half-elf',
        createdAt: new Date('2026-05-14T12:04:00.000Z'),
        modifiedAt: new Date('2026-05-14T12:04:00.000Z'),
    };
};
