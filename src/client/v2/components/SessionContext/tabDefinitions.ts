import type { CreateRun } from '@/dto/index.js';
import { ComponentType } from 'react';
import { Assistant } from '../Assistant/Assistant.js';
import { NpcCards } from '../NpcCards/NpcCards.js';

export const tabKeys = ['assistant', 'npc'] as const;
export type TabKey = typeof tabKeys[number];
export const defaultTabKey: TabKey = 'assistant';

export interface TabInputState {
    prompt: string;
    includePartyContext: boolean;
    retrievalTurnLimit: number;
}

export interface TabDefinition {
    key: TabKey;
    label: string;
    emptyInput: TabInputState;
    buildRun: (input: TabInputState) => CreateRun;
    component: ComponentType;
}

export const tabDefinitions = {
    assistant: {
        key: 'assistant',
        label: 'Assistant',
        emptyInput: {
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        },
        buildRun: input => ({
            kind: 'assistant',
            ...input,
        }),
        component: Assistant,
    },
    npc: {
        key: 'npc',
        label: 'NPC Cards',
        emptyInput: {
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        },
        buildRun: input => ({
            kind: 'npc',
            ...input,
        }),
        component: NpcCards,
    },
} as const satisfies Record<TabKey, TabDefinition>;

export const tabDefinitionList: Readonly<TabDefinition[]> = Object.values(tabDefinitions);
