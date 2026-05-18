import type Database from 'better-sqlite3';

import type { IngestedFile as StoredIngestedFileRow } from '../schema.js';

export const createIngestedFilesRepository = (
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (sourceType: StoredIngestedFileRow['source_type'], filename: string) => {
            const database = await getDatabase();
            const row = database
                .prepare<[StoredIngestedFileRow['source_type'], string], StoredIngestedFileRow>(`
                    SELECT source_type, filename
                    FROM ingested_files
                    WHERE source_type = ? AND filename = ?
                `)
                .get(sourceType, filename);
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare<[], StoredIngestedFileRow>(`
                    SELECT source_type, filename
                    FROM ingested_files
                    ORDER BY source_type, filename
                `)
                .all();
        },
        remove: async (sourceType: StoredIngestedFileRow['source_type'], filename: string) => {
            const database = await getDatabase();
            database
                .prepare(`
                    DELETE FROM ingested_files
                    WHERE source_type = ? AND filename = ?
                `)
                .run(sourceType, filename);
        },
        save: async (file: StoredIngestedFileRow) => {
            const database = await getDatabase();
            database
                .prepare(`
                    INSERT INTO ingested_files (source_type, filename)
                    VALUES (?, ?)
                    ON CONFLICT(source_type, filename) DO NOTHING
                `)
                .run(file.source_type, file.filename);
        },
    });
