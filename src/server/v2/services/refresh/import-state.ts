import type { AppDb } from '@/server/v2/db/app/db.js';
import type { IngestedArticle, SelectRow } from '@/server/v2/db/app/schema.js';
import { Settings, settingKeys } from '@/server/v2/db/app/settingKeys.js';

export interface FoundryImportState {
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
}

export interface ImportStateStore {
    listArticles(): Promise<Array<SelectRow<'ingestedArticles'>>>;
    listFiles(sourceType: 'foundry' | 'pdf'): Promise<string[]>;
    readArticleLastSuccessfulIndexScrapeAt(): Promise<string | null>;
    readFoundry(): Promise<FoundryImportState>;
    replaceArticles(rows: IngestedArticle[]): Promise<void>;
    replaceFiles(sourceType: 'foundry' | 'pdf', filenames: string[]): Promise<void>;
    writeArticleLastSuccessfulIndexScrapeAt(value: string): Promise<void>;
    writeFoundry(state: FoundryImportState['lastSuccessfulExport']): Promise<void>;
}

export const createImportStateStore = (appDb: AppDb): ImportStateStore => ({
    listFiles: async sourceType => appDb.db
        .selectFrom('ingestedFiles')
        .select('filename')
        .where('sourceType', '=', sourceType)
        .orderBy('filename')
        .execute()
        .then(rows => rows.map(row => row.filename)),

    replaceFiles: async (sourceType, filenames) => {
        await appDb.db.transaction().execute(async trx => {
            await trx.deleteFrom('ingestedFiles').where('sourceType', '=', sourceType).execute();

            if (filenames.length > 0) {
                await trx.insertInto('ingestedFiles').values(
                    filenames.map(filename => ({
                        filename,
                        sourceType,
                    })),
                ).execute();
            }
        });
    },

    listArticles: async () => appDb.db
        .selectFrom('ingestedArticles')
        .selectAll()
        .orderBy('canonicalUrl')
        .execute(),

    replaceArticles: async rows => {
        await appDb.db.transaction().execute(async trx => {
            await trx.deleteFrom('ingestedArticles').execute();

            if (rows.length > 0) {
                await trx.insertInto('ingestedArticles').values(rows).execute();
            }
        });
    },

    readArticleLastSuccessfulIndexScrapeAt: async () => Settings.read(appDb.db, settingKeys.articleLastSuccessfulIndexScrapeAt),

    writeArticleLastSuccessfulIndexScrapeAt: async value => {
        await Settings.write(appDb.db, settingKeys.articleLastSuccessfulIndexScrapeAt, value);
    },

    readFoundry: async () => {
        const values = await Settings.readMany(appDb.db, [
            settingKeys.foundryLastSuccessfulExportDeleteCount,
            settingKeys.foundryLastSuccessfulExportFilename,
            settingKeys.foundryLastSuccessfulExportGeneratedAt,
            settingKeys.foundryLastSuccessfulExportRecordCount,
            settingKeys.foundryLastSuccessfulExportRunId,
            settingKeys.foundryLastSuccessfulExportSchemaVersion,
            settingKeys.foundryLastSuccessfulExportUpsertCount,
        ]);
        const filename = values.get(settingKeys.foundryLastSuccessfulExportFilename) ?? null;
        const generatedAt = values.get(settingKeys.foundryLastSuccessfulExportGeneratedAt) ?? null;
        const runId = values.get(settingKeys.foundryLastSuccessfulExportRunId) ?? null;
        const schemaVersion = values.get(settingKeys.foundryLastSuccessfulExportSchemaVersion) ?? null;
        const recordCount = parseInteger(values.get(settingKeys.foundryLastSuccessfulExportRecordCount) ?? null);
        const upsertCount = parseInteger(values.get(settingKeys.foundryLastSuccessfulExportUpsertCount) ?? null);
        const deleteCount = parseInteger(values.get(settingKeys.foundryLastSuccessfulExportDeleteCount) ?? null);

        return {
            appliedExportFilenames: await appDb.db
                .selectFrom('ingestedFiles')
                .select('filename')
                .where('sourceType', '=', 'foundry')
                .orderBy('filename')
                .execute()
                .then(rows => rows.map(row => row.filename)),
            lastSuccessfulExport: filename && generatedAt && runId && schemaVersion && recordCount != null && upsertCount != null && deleteCount != null
                ? {
                    deleteCount,
                    filename,
                    generatedAt,
                    recordCount,
                    runId,
                    schemaVersion,
                    upsertCount,
                }
                : null,
        };
    },

    writeFoundry: async state => {
        if (!state) {
            return;
        }

        await Promise.all([
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportDeleteCount, String(state.deleteCount)),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportFilename, state.filename),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportGeneratedAt, state.generatedAt),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportRecordCount, String(state.recordCount)),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportRunId, state.runId),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportSchemaVersion, state.schemaVersion),
            Settings.write(appDb.db, settingKeys.foundryLastSuccessfulExportUpsertCount, String(state.upsertCount)),
        ]);
    },
});

const parseInteger = (value: string | null): number | null => {
    if (value == null) {
        return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
};
