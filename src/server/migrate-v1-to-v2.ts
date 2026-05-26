// Migration files are for the v1 to v2 transition. These are the only files permitted to touch both codebases.
// These should be deleted during the v1 purge.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { Insertable, Transaction } from 'kysely';

import { createAppDb, AppDatabaseSchema, AppDb } from './db/app/index.js';
import { settingKeys } from './db/app/settings/settingKeys.js';
import { LEGACY_NPC_SESSION_ID } from '@/dto/index.js';

interface LegacyMigrationConfig {
    assistant: {
        additionalContextPath: string;
    };
    cacheDir: string;
    campaign: {
        campaignJournalFolder: string | null;
        partyActorUuids: string[];
        questsJournal: string;
        sessionNotesJournal: string;
    };
    foundryExportDir: string;
    logDir: string;
    pdfDir: string;
    provider: {
        apiKey: string | null;
        baseUrl: string;
        chatModel: string;
        debug: boolean;
        embeddingModel: string;
    };
    repoRoot: string;
    retrievalDir: string;
    stateDir: string;
}

interface LegacyRuntimeState {
    article: {
        knownArticles: Array<{
            canonicalUrl: string;
            firstSeenAt: string;
            lastIngestedAt: string | null;
            scrapeStatus: 'pending' | 'succeeded' | 'failed' | 'inaccessible';
            title: string | null;
        }>;
        lastSuccessfulIndexScrapeAt: string | null;
    };
    foundry: {
        appliedExportFilenames: string[];
        lastSuccessfulExport: {
            deleteCount: number;
            filename: string;
            generatedAt: string;
            recordCount: number;
            runId: string;
            schemaVersion: string;
            upsertCount: number;
        } | null;
    };
    pdf: {
        knownFilenames: string[];
    };
}

interface LegacyStoredNpc {
    age?: string;
    bio: string;
    createdAt: string;
    description: string;
    ethnicity?: string;
    gender?: string;
    id: number;
    name: string;
    role?: string;
    species?: string;
    updatedAt: string;
}

interface MigrationLogger {
    info: (message: string) => void;
    warn: (message: string) => void;
}

export interface MigrationSummary {
    articles: number;
    envSettings: number;
    foundryFiles: number;
    logRuns: number;
    logSessionEntries: number;
    logSessions: number;
    npcRows: number;
    pdfFiles: number;
    singletonSettings: number;
    warnings: number;
}

type DbTransaction = Transaction<AppDatabaseSchema>;

type NormalizedLogEntry =
    | {
        assistant: string;
        kind: 'exchange';
        sourceIndex: number;
        title: string;
        user: string;
    }
    | {
        kind: 'progress';
        message: string;
        sourceIndex: number;
    };

interface NormalizedLogFile {
    entries: NormalizedLogEntry[];
    sessionCreatedAt: Date;
    sessionTitle: string;
}

const LEGACY_LOG_SESSION_ID_PREFIX = 'legacy-log-';
const LEGACY_NPC_RUN_ID = 'legacy-v1-npc-run';
const LEGACY_GENERATED_NPCS_LOG_FILE = 'generated_npcs.md';
const LEGACY_RESPONSE_TITLE = 'Untitled Response';
const LEGACY_LOG_FILENAME_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s+(.+)$/;

export const migrateV1DiskToV2Db = async (
    config: LegacyMigrationConfig,
    appDb: AppDb,
    logger: MigrationLogger = console,
): Promise<MigrationSummary> => {
    let warningCount = 0;
    const warn = (message: string) => {
        warningCount += 1;
        logger.warn(message);
    };

    const summary = await appDb.db.transaction().execute(async trx => {
        const singletonSettings = await migrateSingletonSettings(config, trx);
        const envSettings = await migrateEnvSettings(config, trx);
        const { articles, foundryFiles, pdfFiles } = await migrateRuntimeState(config, trx);
        const npcRows = await migrateLegacyNpcs(config, trx);
        const {
            logRuns,
            logSessionEntries,
            logSessions,
        } = await migrateLogFiles(config, trx, warn);

        return {
            articles,
            envSettings,
            foundryFiles,
            logRuns,
            logSessionEntries,
            logSessions,
            npcRows,
            pdfFiles,
            singletonSettings,
        };
    });

    const result: MigrationSummary = {
        ...summary,
        warnings: warningCount,
    };
    logger.info(`V1->V2 migration complete: ${JSON.stringify(result)}`);
    return result;
};

const migrateSingletonSettings = async (config: LegacyMigrationConfig, trx: DbTransaction): Promise<number> => {
    const currentTime = new Date().toISOString();
    let written = 0;

    const additionalContextStat = await statOrNull(config.assistant.additionalContextPath);
    const additionalContextText = await readTextOrNull(config.assistant.additionalContextPath);
    if (additionalContextText !== null) {
        await upsertSetting(
            trx,
            settingKeys.additionalContext,
            additionalContextText,
            additionalContextStat?.mtime.toISOString() ?? currentTime,
        );
        written += 1;
    }

    return written;
};

const migrateEnvSettings = async (config: LegacyMigrationConfig, trx: DbTransaction): Promise<number> => {
    const modifiedAt = new Date().toISOString();
    const entries: Array<readonly [string, string]> = [
        [settingKeys.articleHtmlCacheDir, toPortableRelativePath(config.repoRoot, path.join(config.cacheDir, 'keith-baker'))],
        [settingKeys.campaignJournalFolder, config.campaign.campaignJournalFolder ?? ''],
        [settingKeys.foundrySourceDir, toPortableRelativePath(config.repoRoot, config.foundryExportDir)],
        [settingKeys.partyActorUuids, JSON.stringify(config.campaign.partyActorUuids)],
        [settingKeys.pdfSourceDir, toPortableRelativePath(config.repoRoot, config.pdfDir)],
        [settingKeys.questsJournal, config.campaign.questsJournal],
        [settingKeys.retrievalDir, toPortableRelativePath(config.repoRoot, config.retrievalDir)],
        [settingKeys.sessionNotesJournal, config.campaign.sessionNotesJournal],
        [settingKeys.providerApiKey, config.provider.apiKey ?? ''],
        [settingKeys.providerBaseUrl, config.provider.baseUrl],
        [settingKeys.providerChatModel, config.provider.chatModel],
        [settingKeys.providerDebug, String(config.provider.debug)],
        [settingKeys.providerEmbeddingModel, config.provider.embeddingModel],
    ];

    for (const [key, value] of entries) {
        await upsertSetting(trx, key, value, modifiedAt);
    }

    return entries.length;
};

const migrateRuntimeState = async (
    config: LegacyMigrationConfig,
    trx: DbTransaction,
): Promise<Pick<MigrationSummary, 'articles' | 'foundryFiles' | 'pdfFiles'> & { singletonSettings: number }> => {
    const runtimeStatePath = path.join(config.stateDir, 'runtime-state.json');
    const runtimeStateText = await readTextOrNull(runtimeStatePath);
    if (runtimeStateText === null) {
        await trx.deleteFrom('ingestedFiles').where('sourceType', 'in', ['foundry', 'pdf']).execute();
        await trx.deleteFrom('ingestedArticles').execute();
        return {
            articles: 0,
            foundryFiles: 0,
            pdfFiles: 0,
            singletonSettings: 0,
        };
    }

    const runtimeState = JSON.parse(runtimeStateText) as LegacyRuntimeState;
    const modifiedAt = (await stat(runtimeStatePath)).mtime.toISOString();

    await upsertNullableSetting(
        trx,
        settingKeys.articleLastSuccessfulIndexScrapeAt,
        runtimeState.article.lastSuccessfulIndexScrapeAt,
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportFilename,
        runtimeState.foundry.lastSuccessfulExport?.filename ?? null,
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportGeneratedAt,
        runtimeState.foundry.lastSuccessfulExport?.generatedAt ?? null,
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportRunId,
        runtimeState.foundry.lastSuccessfulExport?.runId ?? null,
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportSchemaVersion,
        runtimeState.foundry.lastSuccessfulExport?.schemaVersion ?? null,
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportRecordCount,
        runtimeState.foundry.lastSuccessfulExport == null ? null : String(runtimeState.foundry.lastSuccessfulExport.recordCount),
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportUpsertCount,
        runtimeState.foundry.lastSuccessfulExport == null ? null : String(runtimeState.foundry.lastSuccessfulExport.upsertCount),
        modifiedAt,
    );
    await upsertNullableSetting(
        trx,
        settingKeys.foundryLastSuccessfulExportDeleteCount,
        runtimeState.foundry.lastSuccessfulExport == null ? null : String(runtimeState.foundry.lastSuccessfulExport.deleteCount),
        modifiedAt,
    );

    await trx.deleteFrom('ingestedFiles').where('sourceType', 'in', ['foundry', 'pdf']).execute();
    const foundryFiles = dedupeStrings(runtimeState.foundry.appliedExportFilenames);
    const pdfFiles = dedupeStrings(runtimeState.pdf.knownFilenames);

    if (foundryFiles.length > 0) {
        await trx
            .insertInto('ingestedFiles')
            .values(foundryFiles.map(filename => ({
                filename,
                sourceType: 'foundry' as const,
            })))
            .execute();
    }

    if (pdfFiles.length > 0) {
        await trx
            .insertInto('ingestedFiles')
            .values(pdfFiles.map(filename => ({
                filename,
                sourceType: 'pdf' as const,
            })))
            .execute();
    }

    await trx.deleteFrom('ingestedArticles').execute();
    const articles = dedupeArticles(runtimeState.article.knownArticles);
    if (articles.length > 0) {
        await trx
            .insertInto('ingestedArticles')
            .values(articles)
            .execute();
    }

    return {
        articles: articles.length,
        foundryFiles: foundryFiles.length,
        pdfFiles: pdfFiles.length,
        singletonSettings: 9,
    };
};

const migrateLegacyNpcs = async (config: LegacyMigrationConfig, trx: DbTransaction): Promise<number> => {
    const legacyNpcs = await readLegacyNpcInputs(config);

    await deleteSessionIfPresent(trx, LEGACY_NPC_SESSION_ID);
    if (legacyNpcs.length === 0) {
        return 0;
    }

    const createdAt = minimumIsoDate(legacyNpcs.map(npc => npc.createdAt)) ?? new Date().toISOString();
    const updatedAt = maximumIsoDate(legacyNpcs.map(npc => npc.updatedAt)) ?? createdAt;

    const session: Insertable<AppDatabaseSchema['sessions']> = {
        activeRunId: null,
        archivedAt: null,
        createdAt,
        id: LEGACY_NPC_SESSION_ID,
        includePartyContext: 1,
        mode: 'npc',
        title: 'Legacy NPC Imports',
        updatedAt,
    };
    const run: Insertable<AppDatabaseSchema['runs']> = {
        completedAt: updatedAt,
        createdAt,
        error: null,
        failedAt: null,
        id: LEGACY_NPC_RUN_ID,
        includePartyContext: 1,
        mode: 'npc',
        prompt: 'Migrated from .eberron-query-assistant/state/generated-npcs.json',
        retrievalTurnLimit: 0,
        sessionId: LEGACY_NPC_SESSION_ID,
        startedAt: createdAt,
        status: 'completed',
        updatedAt,
    };

    await trx.insertInto('sessions').values(session).execute();
    await trx.insertInto('runs').values(run).execute();
    await trx
        .insertInto('npcs')
        .values(legacyNpcs.map<Insertable<AppDatabaseSchema['npcs']>>(npc => ({
            id: npc.id,
            age: npc.age ?? null,
            bio: npc.bio,
            createdAt: npc.createdAt,
            description: npc.description,
            ethnicity: npc.ethnicity ?? null,
            gender: npc.gender ?? null,
            name: npc.name,
            role: npc.role ?? null,
            runId: LEGACY_NPC_RUN_ID,
            sessionId: LEGACY_NPC_SESSION_ID,
            species: npc.species ?? null,
            updatedAt: npc.updatedAt,
        })))
        .execute();

    return legacyNpcs.length;
};

const migrateLogFiles = async (
    config: LegacyMigrationConfig,
    trx: DbTransaction,
    warn: (message: string) => void,
): Promise<Pick<MigrationSummary, 'logRuns' | 'logSessionEntries' | 'logSessions'>> => {
    const logEntries = await readdirOrEmpty(config.logDir);
    const logFiles = logEntries
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
        .sort((left, right) => left.name.localeCompare(right.name));

    const existingLegacySessions = await trx
        .selectFrom('sessions')
        .select('id')
        .where('id', 'like', `${LEGACY_LOG_SESSION_ID_PREFIX}%`)
        .execute();
    for (const session of existingLegacySessions) {
        await deleteSessionIfPresent(trx, session.id);
    }

    let logRuns = 0;
    let logSessionEntries = 0;
    let logSessions = 0;

    for (const logFile of logFiles) {
        const fullPath = path.join(config.logDir, logFile.name);
        const statResult = await stat(fullPath);
        const normalizedLog = normalizeLogFile(fullPath, statResult, JSON.parse(await readFile(fullPath, 'utf8')) as unknown, warn);
        const sessionId = `${LEGACY_LOG_SESSION_ID_PREFIX}${stableId(path.relative(config.repoRoot, fullPath))}`;
        const sessionUpdatedAt = statResult.mtime.toISOString();

        await trx.insertInto('sessions').values({
            activeRunId: null,
            archivedAt: null,
            createdAt: normalizedLog.sessionCreatedAt.toISOString(),
            id: sessionId,
            includePartyContext: 1,
            mode: 'assistant',
            title: normalizedLog.sessionTitle,
            updatedAt: sessionUpdatedAt,
        }).execute();
        logSessions += 1;

        const pendingProgress: Array<Extract<NormalizedLogEntry, { kind: 'progress' }>> = [];
        let exchangeOrdinal = 0;

        for (const entry of normalizedLog.entries) {
            if (entry.kind === 'progress') {
                pendingProgress.push(entry);
                continue;
            }

            exchangeOrdinal += 1;
            const runSeed = `${path.relative(config.repoRoot, fullPath)}:${entry.sourceIndex}:${exchangeOrdinal}`;
            const runId = `legacy-run-${stableId(runSeed)}`;
            const runCreatedAt = offsetIso(normalizedLog.sessionCreatedAt, (pendingProgress[0]?.sourceIndex ?? entry.sourceIndex) * 1_000);
            const runUpdatedAt = offsetIso(normalizedLog.sessionCreatedAt, entry.sourceIndex * 1_000 + 500);

            await trx.insertInto('runs').values({
                completedAt: runUpdatedAt,
                createdAt: runCreatedAt,
                error: null,
                failedAt: null,
                id: runId,
                includePartyContext: 1,
                mode: 'assistant',
                prompt: entry.user,
                retrievalTurnLimit: 1,
                sessionId,
                startedAt: runCreatedAt,
                status: 'completed',
                updatedAt: runUpdatedAt,
            }).execute();
            logRuns += 1;

            const sessionEntryRows: Insertable<AppDatabaseSchema['sessionEntries']>[] = [{
                content: entry.user,
                createdAt: runCreatedAt,
                id: `legacy-session-entry-${stableId(`${runSeed}:user`)}`,
                kind: 'user',
                runId,
                sequenceIndex: 1,
                sessionId,
                title: null,
                toolCallId: null,
            }];

            let sequenceIndex = 2;
            for (const progressEntry of pendingProgress) {
                sessionEntryRows.push({
                    content: progressEntry.message,
                    createdAt: offsetIso(normalizedLog.sessionCreatedAt, progressEntry.sourceIndex * 1_000 + 100),
                    id: `legacy-session-entry-${stableId(`${runSeed}:progress:${progressEntry.sourceIndex}`)}`,
                    kind: 'reasoning',
                    runId,
                    sequenceIndex,
                    sessionId,
                    title: null,
                    toolCallId: null,
                });
                sequenceIndex += 1;
            }
            pendingProgress.length = 0;

            sessionEntryRows.push({
                content: entry.assistant,
                createdAt: runUpdatedAt,
                id: `legacy-session-entry-${stableId(`${runSeed}:response`)}`,
                kind: 'response',
                runId,
                sequenceIndex,
                sessionId,
                title: entry.title,
                toolCallId: null,
            });

            await trx.insertInto('sessionEntries').values(sessionEntryRows).execute();
            logSessionEntries += sessionEntryRows.length;
        }

        for (const progressEntry of pendingProgress) {
            warn(`Skipping orphaned progress entry in ${fullPath} at index ${progressEntry.sourceIndex}: no following exchange.`);
        }
    }

    return {
        logRuns,
        logSessionEntries,
        logSessions,
    };
};

const readLegacyNpcInputs = async (config: LegacyMigrationConfig): Promise<LegacyStoredNpc[]> => {
    const npcStatePath = path.join(config.stateDir, 'generated-npcs.json');
    const npcStateText = await readTextOrNull(npcStatePath);
    if (npcStateText !== null) {
        return JSON.parse(npcStateText) as LegacyStoredNpc[];
    }

    const legacyNpcLogPath = path.join(config.logDir, LEGACY_GENERATED_NPCS_LOG_FILE);
    const legacyNpcLogText = await readTextOrNull(legacyNpcLogPath);
    if (legacyNpcLogText === null) {
        return [];
    }

    const legacyNpcLogStat = await stat(legacyNpcLogPath);
    return parseLegacyGeneratedNpcMarkdown(legacyNpcLogText, legacyNpcLogStat.mtime.toISOString());
};

const parseLegacyGeneratedNpcMarkdown = (markdown: string, timestamp: string): LegacyStoredNpc[] => {
    const headers = [...markdown.matchAll(/^###[ \t]+(?<id>\d+)\.[ \t]+(?<name>.+?)[ \t]*$/gm)];
    const npcs = headers.map((header, index) => {
        const groups = header.groups;
        const nextHeader = headers[index + 1];
        const body = markdown.slice((header.index ?? 0) + header[0].length, nextHeader?.index ?? markdown.length);
        const descriptionMatch = body.match(/\r?\n\r?\nDescription:\s*(?<description>[\s\S]*?)\r?\n\r?\nBio:/);
        const bioMatch = body.match(/\r?\n\r?\nBio:\s*(?<bio>[\s\S]*?)(?=\r?\n\r?\n## NPC Generation|\s*$)/);

        if (!groups || !descriptionMatch?.groups || !bioMatch?.groups) {
            throw new Error('Legacy generated NPC Markdown contains a malformed NPC card.');
        }

        const description = descriptionMatch.groups.description;
        const bio = bioMatch.groups.bio;
        const name = groups.name;
        if (description === undefined || bio === undefined || name === undefined) {
            throw new Error('Legacy generated NPC Markdown contains a malformed NPC card.');
        }

        return {
            bio: bio.trim(),
            createdAt: timestamp,
            description: description.trim(),
            id: Number(groups.id),
            name: name.trim(),
            updatedAt: timestamp,
        };
    });

    assertUniqueNpcIds(npcs);
    return npcs.sort((left, right) => left.id - right.id);
};

const normalizeLogFile = (
    filePath: string,
    fileStat: Awaited<ReturnType<typeof stat>>,
    raw: unknown,
    warn: (message: string) => void,
): NormalizedLogFile => {
    const basename = path.basename(filePath, path.extname(filePath));
    const filenameMatch = LEGACY_LOG_FILENAME_PATTERN.exec(basename);
    const sessionTitle = filenameMatch?.[7]?.trim() || basename;
    const sessionCreatedAt = filenameMatch
        ? new Date(
            Number(filenameMatch[1]),
            Number(filenameMatch[2]) - 1,
            Number(filenameMatch[3]),
            Number(filenameMatch[4]),
            Number(filenameMatch[5]),
            Number(filenameMatch[6]),
        )
        : fileStat.mtime;

    if (!Array.isArray(raw)) {
        warn(`Skipping invalid log file ${filePath}: expected a JSON array.`);
        return {
            entries: [],
            sessionCreatedAt,
            sessionTitle,
        };
    }

    const entries: NormalizedLogEntry[] = [];
    for (const [index, rawEntry] of raw.entries()) {
        const normalizedEntry = normalizeLogEntry(rawEntry, index, filePath, warn);
        if (normalizedEntry !== null) {
            entries.push(normalizedEntry);
        }
    }

    return {
        entries,
        sessionCreatedAt,
        sessionTitle,
    };
};

const normalizeLogEntry = (
    rawEntry: unknown,
    index: number,
    filePath: string,
    warn: (message: string) => void,
): NormalizedLogEntry | null => {
    if (!isRecord(rawEntry)) {
        warn(`Skipping invalid log entry in ${filePath} at index ${index}: entry is not an object.`);
        return null;
    }

    if (rawEntry.kind === 'progress') {
        if (typeof rawEntry.message !== 'string' || rawEntry.message.trim().length === 0) {
            warn(`Skipping invalid progress entry in ${filePath} at index ${index}: missing message.`);
            return null;
        }
        return {
            kind: 'progress',
            message: rawEntry.message.trim(),
            sourceIndex: index,
        };
    }

    const user = typeof rawEntry.user === 'string' ? rawEntry.user.trim() : null;
    const assistant = typeof rawEntry.assistant === 'string' ? rawEntry.assistant.trim() : null;
    const hasUser = user !== null && user.length > 0;
    const hasAssistant = assistant !== null && assistant.length > 0;

    if (rawEntry.kind === 'exchange') {
        if (!hasUser || !hasAssistant) {
            warn(`Skipping invalid exchange entry in ${filePath} at index ${index}: missing user or assistant.`);
            return null;
        }
        return {
            assistant,
            kind: 'exchange',
            sourceIndex: index,
            title: typeof rawEntry.title === 'string' && rawEntry.title.trim().length > 0
                ? rawEntry.title.trim()
                : LEGACY_RESPONSE_TITLE,
            user,
        };
    }

    if (!('kind' in rawEntry)) {
        if (!hasUser || !hasAssistant) {
            warn(`Skipping invalid legacy exchange entry in ${filePath} at index ${index}: missing user or assistant.`);
            return null;
        }
        return {
            assistant,
            kind: 'exchange',
            sourceIndex: index,
            title: typeof rawEntry.title === 'string' && rawEntry.title.trim().length > 0
                ? rawEntry.title.trim()
                : LEGACY_RESPONSE_TITLE,
            user,
        };
    }

    warn(`Skipping unsupported log entry in ${filePath} at index ${index}.`);
    return null;
};

const upsertSetting = async (
    trx: DbTransaction,
    key: string,
    value: string,
    modifiedAt: string,
): Promise<void> => {
    await trx
        .insertInto('settings')
        .values({ key, modifiedAt, value })
        .onConflict(conflict => conflict.column('key').doUpdateSet({
            modifiedAt,
            value,
        }))
        .execute();
};

const upsertNullableSetting = async (
    trx: DbTransaction,
    key: string,
    value: string | null,
    modifiedAt: string,
): Promise<void> => {
    await upsertSetting(trx, key, value ?? '', modifiedAt);
};

const deleteSessionIfPresent = async (trx: DbTransaction, sessionId: string): Promise<void> => {
    await trx.deleteFrom('sessions').where('id', '=', sessionId).execute();
};

const readTextOrNull = async (filePath: string): Promise<string | null> => {
    try {
        return await readFile(filePath, 'utf8');
    } catch (error) {
        if (hasNodeErrorCode(error, 'ENOENT')) {
            return null;
        }
        throw error;
    }
};

const statOrNull = async (filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> => {
    try {
        return await stat(filePath);
    } catch (error) {
        if (hasNodeErrorCode(error, 'ENOENT')) {
            return null;
        }
        throw error;
    }
};

const readdirOrEmpty = async (directoryPath: string) => {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if (hasNodeErrorCode(error, 'ENOENT')) {
            return [];
        }
        throw error;
    }
};

const dedupeStrings = (values: string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const toPortableRelativePath = (repoRoot: string, targetPath: string): string => path.relative(repoRoot, targetPath).replace(/\\/g, '/');

const dedupeArticles = (
    articles: LegacyRuntimeState['article']['knownArticles'],
): Array<Insertable<AppDatabaseSchema['ingestedArticles']>> => {
    const byUrl = new Map<string, Insertable<AppDatabaseSchema['ingestedArticles']>>();
    for (const article of articles) {
        byUrl.set(article.canonicalUrl, {
            canonicalUrl: article.canonicalUrl,
            firstSeenAt: article.firstSeenAt,
            lastIngestedAt: article.lastIngestedAt,
            scrapeStatus: article.scrapeStatus,
            title: article.title,
        });
    }
    return [...byUrl.values()].sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl));
};

const minimumIsoDate = (values: string[]): string | null => values.length === 0
    ? null
    : values.reduce((minimum, value) => value.localeCompare(minimum) < 0 ? value : minimum);

const maximumIsoDate = (values: string[]): string | null => values.length === 0
    ? null
    : values.reduce((maximum, value) => value.localeCompare(maximum) > 0 ? value : maximum);

const assertUniqueNpcIds = (npcs: LegacyStoredNpc[]): void => {
    if (new Set(npcs.map(npc => npc.id)).size !== npcs.length) {
        throw new Error('Generated NPC state file contains duplicate NPC ids.');
    }
};

const stableId = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 16);

const offsetIso = (baseDate: Date, milliseconds: number): string => new Date(baseDate.getTime() + milliseconds).toISOString();

const hasNodeErrorCode = (error: unknown, code: string): boolean => (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Rebuilds the minimal V1-era path and env view still needed for legacy-data migration. */
export const loadLegacyMigrationConfig = (repoRoot = process.cwd()): LegacyMigrationConfig => {
    const runtimeDir = path.join(repoRoot, '.eberron-query-assistant');
    const assistantDir = path.join(repoRoot, 'assistant');
    const envFile = parseEnvFile(path.join(repoRoot, '.env'));

    return {
        assistant: {
            additionalContextPath: path.join(assistantDir, 'additional-context.md'),
        },
        cacheDir: path.join(runtimeDir, 'cache'),
        campaign: {
            campaignJournalFolder: getConfigValue('EQA_CAMPAIGN_JOURNAL_FOLDER', envFile) ?? 'Legacy',
            partyActorUuids: parseCommaSeparatedList(getConfigValue('EQA_PARTY_ACTOR_UUIDS', envFile)),
            questsJournal: getConfigValue('EQA_QUESTS_JOURNAL', envFile) ?? 'Quests',
            sessionNotesJournal: getConfigValue('EQA_SESSION_NOTES_JOURNAL', envFile) ?? 'Session Notes',
        },
        foundryExportDir: path.join(repoRoot, 'foundry-export'),
        logDir: path.join(repoRoot, 'logs'),
        pdfDir: path.join(repoRoot, 'pdf'),
        provider: {
            apiKey: getConfigValue('OPENAI_API_KEY', envFile) ?? null,
            baseUrl: normalizeBaseUrl(getConfigValue('OPENAI_BASE_URL', envFile) ?? 'https://api.openai.com/v1'),
            chatModel: getConfigValue('OPENAI_CHAT_MODEL', envFile) ?? 'gpt-5.4-mini',
            debug: parseBoolean(getConfigValue('EQA_PROVIDER_DEBUG', envFile)),
            embeddingModel: getConfigValue('OPENAI_EMBEDDING_MODEL', envFile) ?? 'text-embedding-3-small',
        },
        repoRoot,
        retrievalDir: path.join(runtimeDir, 'retrieval'),
        stateDir: path.join(runtimeDir, 'state'),
    };
};

const getConfigValue = (key: string, envFile: Record<string, string>): string | undefined => {
    const value = process.env[key] ?? envFile[key];
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
};

const parseEnvFile = (envPath: string): Record<string, string> => {
    try {
        const text = readFileSync(envPath, 'utf8');
        return parseEnvEntries(text);
    } catch (error) {
        if (hasNodeErrorCode(error, 'ENOENT')) {
            return {};
        }
        throw error;
    }
};

const parseEnvEntries = (text: string): Record<string, string> => {
    const entries: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        entries[key] = unwrapEnvValue(rawValue);
    }
    return entries;
};

const unwrapEnvValue = (value: string): string => {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))
    ) {
        return value.slice(1, -1);
    }

    return value;
};

const parseCommaSeparatedList = (value: string | undefined): string[] => {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
};

const parseBoolean = (value: string | undefined): boolean => value?.toLowerCase() === 'true';

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

export const runMigrationCli = async (): Promise<void> => {
    const config = loadLegacyMigrationConfig();
    const appDb = await createAppDb();

    try {
        await migrateV1DiskToV2Db(config, appDb);
    } finally {
        await appDb.close();
    }
};
