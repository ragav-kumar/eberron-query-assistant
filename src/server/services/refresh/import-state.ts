import { AppDb } from '@server/db/app/db.js';
import { IngestedArticle, SelectRow } from '@server/db/app/schema.js';
import { settingsStore } from '@server/db/app/index.js';

/**
 * App-owned Foundry tracking state used by discovery and completion.
 */
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

/**
 * Refresh-local accessors for persisted import tracking state.
 *
 * These tables and settings exist to support the refresh feature, so the helper
 * stays in the refresh domain instead of becoming a general DB abstraction.
 */
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

/**
 * Creates the import-state helper bound to the current app database.
 */
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

    readArticleLastSuccessfulIndexScrapeAt: () => {
        const value = settingsStore().read('articleLastSuccessfulIndexScrapeAt');
        return Promise.resolve(value?.toISOString() ?? null);
    },

    writeArticleLastSuccessfulIndexScrapeAt: async value => {
        await settingsStore().write(appDb, 'articleLastSuccessfulIndexScrapeAt', new Date(value));
    },

    readFoundry: async () => {
        const store = settingsStore();
        const filename = store.read('foundryLastSuccessfulExportFilename') ?? null;
        const generatedAt = store.read('foundryLastSuccessfulExportGeneratedAt')?.toISOString() ?? null;
        const runId = store.read('foundryLastSuccessfulExportRunId') ?? null;
        const schemaVersion = store.read('foundryLastSuccessfulExportSchemaVersion') ?? null;
        const recordCount = store.read('foundryLastSuccessfulExportRecordCount') ?? null;
        const upsertCount = store.read('foundryLastSuccessfulExportUpsertCount') ?? null;
        const deleteCount = store.read('foundryLastSuccessfulExportDeleteCount') ?? null;

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
            settingsStore().write(appDb, 'foundryLastSuccessfulExportDeleteCount', state.deleteCount),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportFilename', state.filename),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportGeneratedAt', new Date(state.generatedAt)),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportRecordCount', state.recordCount),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportRunId', state.runId),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportSchemaVersion', state.schemaVersion),
            settingsStore().write(appDb, 'foundryLastSuccessfulExportUpsertCount', state.upsertCount),
        ]);
    },
});
