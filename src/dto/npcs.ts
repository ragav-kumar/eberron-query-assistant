export interface NpcDto {
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

export interface NpcListQueryDto {
    filter?: string;
    skip?: string;
    take?: string;
}

export interface NpcCollectionDto {
    filter: string;
    skip: number;
    take: number;

    npcs: NpcDto[];
    totalCount: number;
}
