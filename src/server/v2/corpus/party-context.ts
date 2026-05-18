import { access } from 'node:fs/promises';

import Database from 'better-sqlite3';

import { isRecord } from '@/errors.js';
import type { RuntimeConfig } from '@/types.js';

import { getCorpusDatabasePath } from './database.js';

export interface PartyContextService {
    build(config: RuntimeConfig): Promise<string>;
}

interface FoundrySourceRow {
    content: string;
    metadata: Record<string, unknown>;
    sourceId: string;
    sourceKey: string;
    title: string;
}

const ACTOR_CONTENT_LIMIT = 900;
const LATEST_SESSION_PAGE_LIMIT = 3;
const QUEST_PAGE_LIMIT = 8;
const SESSION_CONTENT_LIMIT = 1_200;
const QUEST_CONTENT_LIMIT = 600;

export const createPartyContextService = (): PartyContextService => ({
    build: async (config) => {
        if (config.campaign.partyActorUuids.length === 0) {
            return [
                'Current party context:',
                '- Party actor UUIDs are not configured. Set EQA_PARTY_ACTOR_UUIDS to enable automatic party context.',
            ].join('\n');
        }

        const databasePath = getCorpusDatabasePath(config);
        if (!(await fileExists(databasePath))) {
            return ['Current party context:', '- Party context unavailable: corpus.sqlite has not been created.'].join('\n');
        }

        const database = new Database(databasePath, { readonly: true });
        try {
            const actors = readPartyActors(database, config.campaign.partyActorUuids);
            const sessionPages = readJournalPages(database, config.campaign.sessionNotesJournal, LATEST_SESSION_PAGE_LIMIT);
            const questPages = readJournalPages(database, config.campaign.questsJournal, QUEST_PAGE_LIMIT);
            const exportGeneratedAt = readExportGeneratedAt([...actors, ...sessionPages, ...questPages]);

            return formatPartyContext({
                actors,
                config,
                exportGeneratedAt,
                questPages,
                sessionPages,
            });
        } finally {
            database.close();
        }
    },
});

interface FormatPartyContextRequest {
    actors: FoundrySourceRow[];
    config: RuntimeConfig;
    exportGeneratedAt: string | null;
    questPages: FoundrySourceRow[];
    sessionPages: FoundrySourceRow[];
}

const formatPartyContext = (request: FormatPartyContextRequest): string => {
    const missingActorUuids = request.config.campaign.partyActorUuids.filter(
        uuid => !request.actors.some(actor => actor.metadata.sourceUuid === uuid),
    );
    const lines = [
        'Current party context:',
        `- Foundry export freshness: ${request.exportGeneratedAt ?? 'unknown'}.`,
        `- Configured campaign journal folder: ${request.config.campaign.campaignJournalFolder ?? 'none'}. Journal matching uses configured journal names when folder metadata is unavailable.`,
        '- Source weighting: Session Notes are authoritative for events that happened in play. Quests are authoritative for active or expected quest threads. Actor-sheet mechanics describe the character sheet. Actor backstory describes what the character believes happened, but may include player error, incomplete knowledge, or unreliable narration.',
        '',
        'Party actors:',
    ];

    if (request.actors.length === 0) {
        lines.push('- No configured party actors were found in the Foundry corpus.');
    } else {
        lines.push(...request.actors.map(actor => formatSourceBullet(actor, ACTOR_CONTENT_LIMIT)));
    }

    if (missingActorUuids.length > 0) {
        lines.push(`- Missing configured actor UUIDs: ${missingActorUuids.join(', ')}.`);
    }

    lines.push('', `Latest ${request.config.campaign.sessionNotesJournal} pages:`);
    if (request.sessionPages.length === 0) {
        lines.push(`- No pages found for journal "${request.config.campaign.sessionNotesJournal}".`);
    } else {
        lines.push(...request.sessionPages.map(page => formatSourceBullet(page, SESSION_CONTENT_LIMIT)));
    }

    lines.push('', `${request.config.campaign.questsJournal} pages:`);
    if (request.questPages.length === 0) {
        lines.push(`- No pages found for journal "${request.config.campaign.questsJournal}".`);
    } else {
        lines.push(...request.questPages.map(page => formatSourceBullet(page, QUEST_CONTENT_LIMIT)));
    }

    return lines.join('\n');
};

const readPartyActors = (database: Database.Database, actorUuids: string[]): FoundrySourceRow[] => {
    const rows = readAllFoundrySources(database).filter(row => actorUuids.includes(readString(row.metadata.sourceUuid)));
    return actorUuids
        .map(uuid => rows.find(row => row.metadata.sourceUuid === uuid))
        .filter((row): row is FoundrySourceRow => row !== undefined);
};

const readJournalPages = (database: Database.Database, journalName: string, limit: number): FoundrySourceRow[] => readAllFoundrySources(database)
    .filter(row => readString(row.metadata.entityKind) === 'JournalEntryPage')
    .filter(row => {
        const sourcePath = readStringArray(row.metadata.provenancePath);
        return sourcePath[0] === journalName;
    })
    .sort(compareJournalPages)
    .slice(0, limit);

const compareJournalPages = (left: FoundrySourceRow, right: FoundrySourceRow): number => {
    const modifiedComparison = compareNullableStrings(
        readString(right.metadata.modifiedTime),
        readString(left.metadata.modifiedTime),
    );
    if (modifiedComparison !== 0) {
        return modifiedComparison;
    }

    return right.title.localeCompare(left.title);
};

const compareNullableStrings = (left: string, right: string): number => {
    if (left.length === 0 && right.length === 0) {
        return 0;
    }
    if (left.length === 0) {
        return 1;
    }
    if (right.length === 0) {
        return -1;
    }
    return left.localeCompare(right);
};

const readAllFoundrySources = (database: Database.Database): FoundrySourceRow[] => {
    const rows = database
        .prepare(
            `SELECT
        s.source_id AS sourceId,
        s.source_key AS sourceKey,
        s.title AS title,
        s.metadata_json AS metadataJson,
        COALESCE(group_concat(c.text, char(10) || char(10)), '') AS content
       FROM sources s
       LEFT JOIN chunks c ON c.source_id = s.source_id
       WHERE s.source_type = 'foundry'
       GROUP BY s.source_id
       ORDER BY s.title`,
        )
        .all() as Array<{
            content: string;
            metadataJson: string;
            sourceId: string;
            sourceKey: string;
            title: string;
        }>;

    return rows.map(row => ({
        content: row.content,
        metadata: parseMetadata(row.metadataJson),
        sourceId: row.sourceId,
        sourceKey: row.sourceKey,
        title: row.title,
    }));
};

const formatSourceBullet = (row: FoundrySourceRow, contentLimit: number): string => {
    const locator = readString(row.metadata.citationAnchor) || readString(row.metadata.entityKind);
    const sourceUuid = readString(row.metadata.sourceUuid);
    const content = summarizeContent(row.content, contentLimit);
    return [
        `- ${row.title}${locator ? ` (${locator})` : ''}${sourceUuid ? ` [${sourceUuid}]` : ''}:`,
        `  ${content || 'No text content exported for this record.'}`,
    ].join('\n');
};

const summarizeContent = (content: string, limit: number): string => {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) {
        return normalized;
    }

    return `${normalized.slice(0, limit - 3).trimEnd()}...`;
};

const readExportGeneratedAt = (rows: FoundrySourceRow[]): string | null => {
    for (const row of rows) {
        const generatedAt = readString(row.metadata.exportGeneratedAt);
        if (generatedAt.length > 0) {
            return generatedAt;
        }
    }
    return null;
};

const parseMetadata = (value: string): Record<string, unknown> => {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
};

const readString = (value: unknown): string => {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return '';
};

const readStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
};
