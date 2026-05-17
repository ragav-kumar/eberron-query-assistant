import { mapNpcRow, toTimestamp } from '../mappers.js';
import type { V2Orm } from '../contract.js';
import type { Npc as StoredNpcRow } from '../schema.js';

import type { RepositoryDependencies } from './shared.js';

type NpcRepository = V2Orm['npcs'];

const NPC_SELECT = `
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
        updated_at
    FROM npcs
`;

const NPC_LIST_ORDER = 'ORDER BY updated_at DESC, id DESC';

export const createNpcRepository = (
    { getDatabase }: RepositoryDependencies,
): NpcRepository => {
    return {
        get: async id => {
            const database = await getDatabase();
            const row = database
                .prepare(`
                    ${NPC_SELECT}
                    WHERE id = ?
                `)
                .get(id) as StoredNpcRow | undefined;
            return row ? mapNpcRow(row) : null;
        },
        list: async () => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    ${NPC_SELECT}
                    ${NPC_LIST_ORDER}
                `)
                .all() as StoredNpcRow[];
            return rows.map(mapNpcRow);
        },
        listByRun: async runId => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    ${NPC_SELECT}
                    WHERE run_id = ?
                    ${NPC_LIST_ORDER}
                `)
                .all(runId) as StoredNpcRow[];
            return rows.map(mapNpcRow);
        },
        listBySession: async sessionId => {
            const database = await getDatabase();
            const rows = database
                .prepare(`
                    ${NPC_SELECT}
                    WHERE session_id = ?
                    ${NPC_LIST_ORDER}
                `)
                .all(sessionId) as StoredNpcRow[];
            return rows.map(mapNpcRow);
        },
        save: async npc => {
            const database = await getDatabase();
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
                        updated_at
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
                        updated_at = excluded.updated_at
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
                    toTimestamp(npc.updatedAt),
                );
        },
    };
};
