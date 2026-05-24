import { CreateRunDto, SessionMode } from '@/dto/index.js';

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
    },
} as const satisfies Record<SessionMode, TabDefinition>;

export const tabDefinitionList: Readonly<TabDefinition[]> = Object.values(tabDefinitions);
