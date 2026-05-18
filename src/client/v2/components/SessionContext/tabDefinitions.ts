import { CreateRunDto, SessionMode } from '@/dto/index.js';
import { ComponentType } from 'react';
import { Assistant } from '../Assistant.js';
import { NpcCards } from '../NpcCards/NpcCards.js';

export const defaultTabKey: SessionMode = 'assistant';

export interface TabInputState {
    key: SessionMode;
    prompt: string;
    includePartyContext: boolean;
    retrievalTurnLimit: number;
}

export interface TabDefinition {
    key: SessionMode;
    label: string;
    emptyInput: TabInputState;
    buildRun: (input: TabInputState) => CreateRunDto;
    component: ComponentType;
}

export const tabDefinitions = {
    assistant: {
        key: 'assistant',
        label: 'Assistant',
        emptyInput: {
            key: 'assistant',
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        },
        buildRun: input => ({
            mode: 'assistant',
            ...input,
        }),
        component: Assistant,
    },
    npc: {
        key: 'npc',
        label: 'NPC Cards',
        emptyInput: {
            key: 'npc',
            prompt: '',
            includePartyContext: true,
            retrievalTurnLimit: 1,
        },
        buildRun: input => ({
            mode: 'npc',
            ...input,
        }),
        component: NpcCards,
    },
} as const satisfies Record<SessionMode, TabDefinition>;

export const tabDefinitionList: Readonly<TabDefinition[]> = Object.values(tabDefinitions);
