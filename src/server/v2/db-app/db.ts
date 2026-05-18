import { Kysely, SqliteDialect } from 'kysely';

import type { RuntimeConfig } from '@/types.js';

import { createAppDatabase, getAppDatabasePath, type AppDatabaseBootstrap } from './database.js';
import type { AppDatabaseSchema } from './schema.js';
import { createSchema } from './schemaDefinition.js';

export interface AppDb {
    close: () => Promise<void>;
    db: Kysely<AppDatabaseSchema>;
}

export const createAppDb = async (bootstrap: AppDatabaseBootstrap | RuntimeConfig): Promise<AppDb> => {
    const appDatabase = createAppDatabase();
    const database = await appDatabase.open(toBootstrap(bootstrap));

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

const toBootstrap = (bootstrap: AppDatabaseBootstrap | RuntimeConfig): AppDatabaseBootstrap => (
    'databasePath' in bootstrap
        ? bootstrap
        : { databasePath: getAppDatabasePath(bootstrap) }
);
