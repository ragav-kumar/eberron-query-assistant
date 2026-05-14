import { mapNpcRow, toTimestamp } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { StoredNpcRow } from '../storedRows.js';

import type { RepositoryDependencies } from './shared.js';
import type { V2Loaders } from '../loaders.js';

type NpcRepository = V2Orm['npcs'];

export const createNpcRepository = (
    { getDatabase }: RepositoryDependencies,
    loaders: Pick<V2Loaders, 'loadNpcsByRun'>,
): NpcRepository => {
    return {
        async get(config, id) {
            const database = await getDatabase(config);
            const row = database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        run_id,
                        name,
                        bio,
                        description,
                        age,
                        ethnicity,
                        gender,
                        role,
                        species,
                        created_at,
                        modified_at
                    FROM npcs
                    WHERE id = ?
                `)
                .get(id) as StoredNpcRow | undefined;
            return row ? mapNpcRow(row) : null;
        },
        async list(config) {
            const database = await getDatabase(config);
            const rows = database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        run_id,
                        name,
                        bio,
                        description,
                        age,
                        ethnicity,
                        gender,
                        role,
                        species,
                        created_at,
                        modified_at
                    FROM npcs
                    ORDER BY id ASC
                `)
                .all() as StoredNpcRow[];
            return rows.map(mapNpcRow);
        },
        async listByRun(config, runId) {
            const database = await getDatabase(config);
            return loaders.loadNpcsByRun(database, runId);
        },
        async listBySession(config, sessionId) {
            const database = await getDatabase(config);
            const rows = database
                .prepare(`
                    SELECT
                        id,
                        session_id,
                        run_id,
                        name,
                        bio,
                        description,
                        age,
                        ethnicity,
                        gender,
                        role,
                        species,
                        created_at,
                        modified_at
                    FROM npcs
                    WHERE session_id = ?
                    ORDER BY id ASC
                `)
                .all(sessionId) as StoredNpcRow[];
            return rows.map(mapNpcRow);
        },
        async save(config, npc) {
            const database = await getDatabase(config);
            database
                .prepare(`
                    INSERT INTO npcs (
                        id,
                        session_id,
                        run_id,
                        name,
                        bio,
                        description,
                        age,
                        ethnicity,
                        gender,
                        role,
                        species,
                        created_at,
                        modified_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        session_id = excluded.session_id,
                        run_id = excluded.run_id,
                        name = excluded.name,
                        bio = excluded.bio,
                        description = excluded.description,
                        age = excluded.age,
                        ethnicity = excluded.ethnicity,
                        gender = excluded.gender,
                        role = excluded.role,
                        species = excluded.species,
                        created_at = excluded.created_at,
                        modified_at = excluded.modified_at
                `)
                .run(
                    npc.id,
                    npc.sessionId,
                    npc.runId,
                    npc.name,
                    npc.bio,
                    npc.description,
                    npc.age ?? null,
                    npc.ethnicity ?? null,
                    npc.gender ?? null,
                    npc.role ?? null,
                    npc.species ?? null,
                    toTimestamp(npc.createdAt),
                    toTimestamp(npc.modifiedAt),
                );
        },
    };
};
