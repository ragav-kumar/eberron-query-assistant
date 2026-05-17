export interface Npc {
    age?: string;
    bio: string;
    createdAt?: string;
    description: string;
    ethnicity?: string;
    gender?: string;
    id: number;
    name: string;
    role?: string;
    sessionId: string;
    runId?: string;
    species?: string;
    updatedAt?: string;
}

export interface NpcListQuery {
    filter?: string;
    skip?: string;
    take?: string;
}

export interface NpcCollection {
    filter: string;
    skip: number;
    take: number;

    npcs: Npc[];
    totalCount: number;
}