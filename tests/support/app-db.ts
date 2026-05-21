import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { initializeSettingsStore } from '@server/db/app/index.js';
import type { AppDb } from '@server/db/app/db.js';
import type { AppDatabaseSchema } from '@server/db/app/schema.js';
import { createSchema } from '@server/db/app/schemaDefinition.js';

/**
 * Creates an isolated in-memory app database and initializes the V2 settings
 * store so tests can exercise real query behavior without touching live paths.
 */
export const createInMemoryAppDb = async (): Promise<AppDb & { destroy: () => Promise<void> }> => {
    const sqlite = new Database(':memory:');
    const db = new Kysely<AppDatabaseSchema>({
        dialect: new SqliteDialect({
            database: sqlite,
        }),
    });

    await createSchema(db);
    const appDb: AppDb = {
        close: async () => {
            await db.destroy();
            sqlite.close();
        },
        db,
    };
    await initializeSettingsStore(appDb);

    return {
        ...appDb,
        destroy: appDb.close,
    };
};
