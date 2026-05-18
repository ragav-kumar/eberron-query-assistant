import type { RouteDefinition } from './shared.js';
import { writeJson } from '../response.js';
import { Npc, NpcCollection } from '@/dto/index.js';

export const npcRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/npcs',
        handler: async ({response, queryParams, context}) => {
            const skip = queryParams.skip ? parseInt(queryParams.skip) : 0;
            const take = queryParams.take ? parseInt(queryParams.take) : 20;
            const filter = queryParams.filter ?? '';

            const npcRows = await context.db
                .selectFrom('npcs')
                .selectAll()
                .where('name', 'like', `%${filter}%`)
                .orderBy('id', 'desc')
                .offset(skip)
                .limit(take)
                .execute();

            const count = await context.db
                .selectFrom('npcs')
                .select(ctx => ctx.fn.countAll().as('totalCount'))
                .where('name', 'like', `%${filter}%`)
                .executeTakeFirstOrThrow();

            const npcDtos = npcRows.map<Npc>(npc => ({
                ...npc,
                age: npc.age ?? undefined,
                createdAt: npc.createdAt ?? undefined,
                ethnicity: npc.ethnicity ?? undefined,
                gender: npc.gender ?? undefined,
                role: npc.role ?? undefined,
                species: npc.species ?? undefined,
                updatedAt: npc.updatedAt ?? undefined,
            }));

            writeJson(response, {
                npcs: npcDtos,
                filter,
                skip,
                take,
                totalCount: count.totalCount as number,
            } satisfies NpcCollection);
        },
    },
];
