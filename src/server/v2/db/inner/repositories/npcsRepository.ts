import type Database from 'better-sqlite3';

import type { Npc as StoredNpcRow } from '../schema.js';

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
    getDatabase: () => Promise<Database.Database>,
) => ({
        get: async (id: number) => {
            const database = await getDatabase();
            const row = database
                .prepare<[number], StoredNpcRow>(`
                    ${NPC_SELECT}
                    WHERE id = ?
                `)
                .get(id);
            return row ?? null;
        },
        list: async () => {
            const database = await getDatabase();
            return database
                .prepare<[], StoredNpcRow>(`
                    ${NPC_SELECT}
                    ${NPC_LIST_ORDER}
                `)
                .all();
        },
        listByRun: async (runId: string) => {
            const database = await getDatabase();
            return database
                .prepare<[string], StoredNpcRow>(`
                    ${NPC_SELECT}
                    WHERE run_id = ?
                    ${NPC_LIST_ORDER}
                `)
                .all(runId);
        },
        listBySession: async (sessionId: string) => {
            const database = await getDatabase();
            return database
                .prepare<[string], StoredNpcRow>(`
                    ${NPC_SELECT}
                    WHERE session_id = ?
                    ${NPC_LIST_ORDER}
                `)
                .all(sessionId);
        },
        save: async (npc: StoredNpcRow) => {
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
                    npc.session_id,
                    npc.run_id,
                    npc.name,
                    npc.bio,
                    npc.description,
                    npc.age ?? null,
                    npc.ethnicity ?? null,
                    npc.gender ?? null,
                    npc.role ?? null,
                    npc.species ?? null,
                    npc.created_at,
                    npc.updated_at,
                );
        },
    });
