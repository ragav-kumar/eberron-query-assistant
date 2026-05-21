import { Kysely, SqliteDialect } from 'kysely';

import { createAppDatabase } from './database.js';
import type { AppDatabaseSchema } from './schema.js';
import { createSchema } from './schemaDefinition.js';
import { appDbPath } from '@server/defaults.js';

export interface AppDb {
    close: () => Promise<void>;
    db: Kysely<AppDatabaseSchema>;
}

export const createAppDb = async (): Promise<AppDb> => {
    const appDatabase = createAppDatabase();
    const database = await appDatabase.open(appDbPath);

    const db = new Kysely<AppDatabaseSchema>({
        dialect: new SqliteDialect({
            database,
        }),
    });

    await createSchema(db);

    return {
        close: async () => {
            await db.destroy();
            appDatabase.close();
        },
        db,
    };
};
