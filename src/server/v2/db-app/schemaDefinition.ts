import { sql, type Kysely } from 'kysely';

import {
    sessionModes,
} from '@/types.js';

import type { AppDatabaseSchema } from './schema.js';

const refreshOperationKinds = ['refresh', 'reingest'] as const;
const refreshStatuses = ['idle', 'pending', 'running', 'completed', 'failed'] as const;
const runStatuses = ['pending', 'running', 'completed', 'failed'] as const;
const sessionFeedEntryKinds = ['user', 'reasoning', 'response'] as const;

const quoteSqlStrings = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');

const SESSION_MODE_SQL = quoteSqlStrings(sessionModes);
const RUN_STATUS_SQL = quoteSqlStrings(runStatuses);
const REFRESH_OPERATION_SQL = quoteSqlStrings(refreshOperationKinds);
const REFRESH_STATUS_SQL = quoteSqlStrings(refreshStatuses);
const SESSION_ENTRY_KIND_SQL = quoteSqlStrings(sessionFeedEntryKinds);

export const createSchema = async (db: Kysely<AppDatabaseSchema>): Promise<void> => {
    await db.schema
        .createTable('settings')
        .ifNotExists()
        .addColumn('key', 'text', column => column.primaryKey())
        .addColumn('value', 'text', column => column.notNull())
        .addColumn('modifiedAt', 'text', column => column.notNull())
        .execute();

    await db.schema
        .createTable('ingestedFiles')
        .ifNotExists()
        .addColumn('sourceType', 'text', column => column.notNull().check(sql`sourceType in ('foundry', 'pdf')`))
        .addColumn('filename', 'text', column => column.notNull())
        .addPrimaryKeyConstraint('ingestedFilesPrimaryKey', ['sourceType', 'filename'])
        .execute();

    await db.schema
        .createTable('ingestedArticles')
        .ifNotExists()
        .addColumn('canonicalUrl', 'text', column => column.primaryKey())
        .addColumn('title', 'text')
        .addColumn('firstSeenAt', 'text', column => column.notNull())
        .addColumn('lastIngestedAt', 'text')
        .addColumn('scrapeStatus', 'text', column => column.notNull().check(sql`scrapeStatus in ('pending', 'succeeded', 'failed', 'inaccessible')`))
        .execute();

    await db.schema
        .createTable('refreshState')
        .ifNotExists()
        .addColumn('singletonKey', 'integer', column => column.primaryKey().check(sql`singletonKey = 1`))
        .addColumn('activeOperation', 'text', column => column.check(sql`activeOperation in (${sql.raw(REFRESH_OPERATION_SQL)}) or activeOperation is null`))
        .addColumn('refreshStatus', 'text', column => column.notNull().check(sql`refreshStatus in (${sql.raw(REFRESH_STATUS_SQL)})`))
        .addColumn('reingestStatus', 'text', column => column.notNull().check(sql`reingestStatus in (${sql.raw(REFRESH_STATUS_SQL)})`))
        .addColumn('lastRefreshAt', 'text')
        .addColumn('lastReingestAt', 'text')
        .addColumn('createdAt', 'text', column => column.notNull())
        .addColumn('updatedAt', 'text', column => column.notNull())
        .execute();

    await db.schema
        .createTable('sessions')
        .ifNotExists()
        .addColumn('id', 'text', column => column.primaryKey())
        .addColumn('mode', 'text', column => column.notNull().check(sql`mode in (${sql.raw(SESSION_MODE_SQL)})`))
        .addColumn('title', 'text', column => column.notNull())
        .addColumn('activeRunId', 'text', column => column.references('runs.id').onDelete('set null'))
        .addColumn('includePartyContext', 'integer', column => column.notNull().check(sql`includePartyContext in (0, 1)`))
        .addColumn('archivedAt', 'text')
        .addColumn('createdAt', 'text', column => column.notNull())
        .addColumn('updatedAt', 'text', column => column.notNull())
        .execute();

    await db.schema
        .createTable('runs')
        .ifNotExists()
        .addColumn('id', 'text', column => column.primaryKey())
        .addColumn('sessionId', 'text', column => column.notNull().references('sessions.id').onDelete('cascade'))
        .addColumn('mode', 'text', column => column.notNull().check(sql`mode in (${sql.raw(SESSION_MODE_SQL)})`))
        .addColumn('status', 'text', column => column.notNull().check(sql`status in (${sql.raw(RUN_STATUS_SQL)})`))
        .addColumn('prompt', 'text', column => column.notNull())
        .addColumn('retrievalTurnLimit', 'integer', column => column.notNull())
        .addColumn('includePartyContext', 'integer', column => column.notNull().check(sql`includePartyContext in (0, 1)`))
        .addColumn('error', 'text')
        .addColumn('createdAt', 'text', column => column.notNull())
        .addColumn('updatedAt', 'text', column => column.notNull())
        .addColumn('startedAt', 'text')
        .addColumn('completedAt', 'text')
        .addColumn('failedAt', 'text')
        .execute();

    await db.schema
        .createTable('sessionEntries')
        .ifNotExists()
        .addColumn('id', 'text', column => column.primaryKey())
        .addColumn('sessionId', 'text', column => column.notNull().references('sessions.id').onDelete('cascade'))
        .addColumn('runId', 'text', column => column.notNull().references('runs.id').onDelete('cascade'))
        .addColumn('sequenceIndex', 'integer', column => column.notNull())
        .addColumn('kind', 'text', column => column.notNull().check(sql`kind in (${sql.raw(SESSION_ENTRY_KIND_SQL)})`))
        .addColumn('content', 'text', column => column.notNull())
        .addColumn('title', 'text')
        .addColumn('toolCallId', 'text')
        .addColumn('createdAt', 'text', column => column.notNull())
        .execute();

    await db.schema
        .createTable('npcs')
        .ifNotExists()
        .addColumn('id', 'integer', column => column.primaryKey())
        .addColumn('sessionId', 'text', column => column.notNull().references('sessions.id').onDelete('cascade'))
        .addColumn('runId', 'text', column => column.notNull().references('runs.id').onDelete('cascade'))
        .addColumn('name', 'text', column => column.notNull())
        .addColumn('bio', 'text', column => column.notNull())
        .addColumn('description', 'text', column => column.notNull())
        .addColumn('age', 'text')
        .addColumn('ethnicity', 'text')
        .addColumn('gender', 'text')
        .addColumn('role', 'text')
        .addColumn('species', 'text')
        .addColumn('createdAt', 'text')
        .addColumn('updatedAt', 'text')
        .execute();

    await db.schema
        .createTable('consoleEntries')
        .ifNotExists()
        .addColumn('id', 'text', column => column.primaryKey())
        .addColumn('level', 'text', column => column.notNull().check(sql`level in ('debug', 'error', 'info', 'warn')`))
        .addColumn('message', 'text', column => column.notNull())
        .addColumn('createdAt', 'text', column => column.notNull())
        .execute();

    await db.schema
        .createIndex('idxSessionEntriesSessionSequence')
        .ifNotExists()
        .on('sessionEntries')
        .columns(['sessionId', 'sequenceIndex', 'id'])
        .execute();

    await db.schema
        .createIndex('idxSessionEntriesRunSequence')
        .ifNotExists()
        .on('sessionEntries')
        .columns(['runId', 'sequenceIndex', 'id'])
        .execute();

    await db.schema
        .createIndex('idxNpcsRunId')
        .ifNotExists()
        .on('npcs')
        .columns(['runId', 'id'])
        .execute();

    await db.schema
        .createIndex('idxNpcsSessionUpdated')
        .ifNotExists()
        .on('npcs')
        .columns(['sessionId', 'updatedAt desc', 'id desc'])
        .execute();

    await db.schema
        .createIndex('idxNpcsUpdated')
        .ifNotExists()
        .on('npcs')
        .columns(['updatedAt desc', 'id desc'])
        .execute();

    await db.schema
        .createIndex('idxConsoleEntriesCreated')
        .ifNotExists()
        .on('consoleEntries')
        .columns(['createdAt', 'id'])
        .execute();

    await db.schema
        .createIndex('idxIngestedFilesSourceType')
        .ifNotExists()
        .on('ingestedFiles')
        .columns(['sourceType', 'filename'])
        .execute();

    await db.schema
        .createIndex('idxIngestedArticlesScrapeStatus')
        .ifNotExists()
        .on('ingestedArticles')
        .columns(['scrapeStatus', 'canonicalUrl'])
        .execute();
};
