import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createOrm, getAppDatabasePath } from '@/server/v2/db/index.js';

const TEST_ROOT = path.resolve('.test-tmp', 'v2-orm');

describe('V2 ORM', () => {
    beforeEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    afterEach(async () => {
        await rm(TEST_ROOT, { force: true, recursive: true });
    });

    it('creates the expected v2 schema tables', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);

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
                    'console_entries',
                    'npcs',
                    'refresh_state',
                    'runs',
                    'session_exchanges',
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

    it('round-trips generic settings rows', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const setting = createSetting();

        try {
            await orm.bootstrap();
            await orm.settings.save(setting);

            await expect(orm.settings.get(setting.key)).resolves.toMatchObject({
                key: setting.key,
                value: setting.value,
            });
            await expect(orm.settings.list()).resolves.toEqual([expect.objectContaining({
                key: setting.key,
                value: setting.value,
            })]);
        } finally {
            orm.close();
        }
    });

    it('round-trips refresh state through the singleton repository', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const refreshState = createRefreshState();

        try {
            await orm.bootstrap();
            await orm.refreshState.save(refreshState);

            await expect(orm.refreshState.get()).resolves.toMatchObject({
                activeOperation: 'refresh',
                refreshStatus: 'running',
                reingestStatus: 'idle',
            });
        } finally {
            orm.close();
        }
    });

    it('loads a session with ordered exchanges and a resolved active run', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const session = {
            ...createSession(),
            activeRunId: 'run-1',
        };
        const run = createRun();
        const reasoningExchange = createReasoningExchange();
        const userExchange = createUserExchange();
        const responseExchange = createResponseExchange();

        try {
            await orm.bootstrap();
            await orm.sessions.save({
                ...session,
                activeRunId: null,
            });
            await orm.runs.save(run);
            await orm.sessions.save(session);
            await orm.sessionExchanges.save(reasoningExchange);
            await orm.sessionExchanges.save(responseExchange);
            await orm.sessionExchanges.save(userExchange);

            const loaded = await orm.sessions.get(session.id);

            expect(loaded).toMatchObject({
                id: session.id,
                activeRunId: run.id,
                activeRun: {
                    exchangeId: run.exchangeId,
                    id: run.id,
                },
                includePartyContext: true,
            });
            expect(loaded?.exchanges.map((exchange) => exchange.sequenceIndex)).toEqual([1, 2, 3]);
            expect(loaded?.exchanges.map((exchange) => exchange.kind)).toEqual(['user', 'reasoning', 'response']);
        } finally {
            orm.close();
        }
    });

    it('preserves reasoning tool call ids and run exchange ids', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const session = createSession();
        const run = createRun();
        const reasoningExchange = createReasoningExchange();

        try {
            await orm.bootstrap();
            await orm.sessions.save(session);
            await orm.runs.save(run);
            await orm.sessionExchanges.save(reasoningExchange);

            const loadedRun = await orm.runs.get(run.id);
            const loadedExchange = await orm.sessionExchanges.get(reasoningExchange.id);

            expect(loadedRun).toMatchObject({
                exchangeId: run.exchangeId,
                status: run.status,
            });
            expect(loadedExchange).toMatchObject({
                id: reasoningExchange.id,
                kind: 'reasoning',
                toolCallId: reasoningExchange.toolCallId,
            });
        } finally {
            orm.close();
        }
    });

    it('round-trips failed runs including nullable lifecycle timestamps and error', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const session = createSession();
        const failedRun = {
            ...createRun(),
            error: 'Provider request failed.',
            failedAt: new Date('2026-05-14T12:02:00.000Z'),
            startedAt: null,
            status: 'failed' as const,
        };

        try {
            await orm.bootstrap();
            await orm.sessions.save(session);
            await orm.runs.save(failedRun);

            const loaded = await orm.runs.get(failedRun.id);

            expect(loaded).toMatchObject({
                error: failedRun.error,
                exchangeId: failedRun.exchangeId,
                status: 'failed',
            });
            expect(loaded?.startedAt).toBeNull();
            expect(loaded?.completedAt).toBeNull();
            expect(loaded?.failedAt?.toISOString()).toBe(failedRun.failedAt.toISOString());
        } finally {
            orm.close();
        }
    });

    it('lists NPC rows newest-first by updatedAt', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const session = createSession();
        const run = createRun();
        const olderNpc = createNpc();
        const newerNpc = {
            ...createNpc(),
            id: 2,
            name: 'Tavin',
            updatedAt: new Date('2026-05-14T12:05:00.000Z'),
        };

        try {
            await orm.bootstrap();
            await orm.sessions.save(session);
            await orm.runs.save(run);
            await orm.npcs.save(olderNpc);
            await orm.npcs.save(newerNpc);

            const allNpcs = await orm.npcs.list();
            const runNpcs = await orm.npcs.listByRun(run.id);

            expect(allNpcs.map((npc) => npc.name)).toEqual(['Tavin', 'Ilyra']);
            expect(runNpcs.map((npc) => npc.name)).toEqual(['Tavin', 'Ilyra']);
        } finally {
            orm.close();
        }
    });

    it('round-trips console entries independently of sessions and runs', async () => {
        const config = loadDefaultConfig(TEST_ROOT);
        const orm = createOrm(config);
        const olderEntry = createConsoleEntry();
        const newerEntry = {
            ...createConsoleEntry(),
            createdAt: new Date('2026-05-14T12:06:00.000Z'),
            id: 'console-2',
            level: 'warn' as const,
            message: 'Later warning.',
        };

        try {
            await orm.bootstrap();
            await orm.consoleEntries.save(newerEntry);
            await orm.consoleEntries.save(olderEntry);

            const loaded = await orm.consoleEntries.list();

            expect(loaded.map((entry) => entry.id)).toEqual(['console-1', 'console-2']);
            await expect(orm.consoleEntries.get(olderEntry.id)).resolves.toMatchObject({
                level: 'info',
                message: olderEntry.message,
            });
        } finally {
            orm.close();
        }
    });
});

const createSetting = () => ({
        key: 'additionalContext',
        modifiedAt: new Date('2026-05-14T12:00:00.000Z'),
        value: 'Keep the tone grounded.',
    });

const createRefreshState = () => ({
        activeOperation: 'refresh' as const,
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        lastRefreshAt: new Date('2026-05-14T12:01:00.000Z'),
        lastReingestAt: null,
        refreshStatus: 'running' as const,
        reingestStatus: 'idle' as const,
        updatedAt: new Date('2026-05-14T12:01:00.000Z'),
    });

const createSession = () => ({
        activeRun: null,
        activeRunId: null,
        archivedAt: null,
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        exchanges: [],
        id: 'session-1',
        includePartyContext: true,
        mode: 'assistant' as const,
        title: 'Session One',
        updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

const createRun = () => ({
        completedAt: null,
        createdAt: new Date('2026-05-14T12:01:00.000Z'),
        exchangeId: 'exchange-1',
        failedAt: null,
        id: 'run-1',
        includePartyContext: true,
        mode: 'assistant' as const,
        prompt: 'Draft a scene.',
        retrievalTurnLimit: 2,
        sessionId: 'session-1',
        startedAt: new Date('2026-05-14T12:01:05.000Z'),
        status: 'running' as const,
        updatedAt: new Date('2026-05-14T12:01:10.000Z'),
    });

const createUserExchange = () => ({
        content: 'Tell me about Sharn.',
        createdAt: new Date('2026-05-14T12:01:11.000Z'),
        exchangeId: 'exchange-1',
        id: 'exchange-entry-1',
        kind: 'user' as const,
        runId: 'run-1',
        sequenceIndex: 1,
        sessionId: 'session-1',
    });

const createReasoningExchange = () => ({
        content: 'Checking retrieved notes about districts and tone.',
        createdAt: new Date('2026-05-14T12:01:12.000Z'),
        exchangeId: 'exchange-1',
        id: 'exchange-entry-2',
        kind: 'reasoning' as const,
        runId: 'run-1',
        sequenceIndex: 2,
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
    });

const createResponseExchange = () => ({
        content: 'Sharn rises in layered towers above the Dagger River.',
        createdAt: new Date('2026-05-14T12:01:13.000Z'),
        exchangeId: 'exchange-1',
        id: 'exchange-entry-3',
        kind: 'response' as const,
        runId: 'run-1',
        sequenceIndex: 3,
        sessionId: 'session-1',
        title: 'Sharn overview',
    });

const createNpc = () => ({
        age: '30s',
        bio: 'A quiet scout from Aundair.',
        createdAt: new Date('2026-05-14T12:04:00.000Z'),
        description: 'Lean half-elf with a weather-worn cloak.',
        ethnicity: 'Aundairian',
        gender: 'Woman',
        id: 1,
        name: 'Ilyra',
        role: 'Scout',
        runId: 'run-1',
        sessionId: 'session-1',
        species: 'Half-elf',
        updatedAt: new Date('2026-05-14T12:04:00.000Z'),
    });

const createConsoleEntry = () => ({
        createdAt: new Date('2026-05-14T12:05:00.000Z'),
        id: 'console-1',
        level: 'info' as const,
        message: 'Refresh complete.',
    });
