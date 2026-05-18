import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionMode } from '@/types.js';

const promptsDirectory = path.dirname(fileURLToPath(import.meta.url));

const v2PromptAssetPaths = {
    sharedExchangeProtocol: path.join(promptsDirectory, 'shared-exchange-protocol.md'),
    assistantMode: path.join(promptsDirectory, 'mode-assistant.md'),
    npcMode: path.join(promptsDirectory, 'mode-npc.md'),
    sessionTitling: path.join(promptsDirectory, 'session-titling.md'),
} as const;

const v2PromptAssembly = {
    assistant: v2PromptAssetPaths.assistantMode,
    npc: v2PromptAssetPaths.npcMode,
    shared: v2PromptAssetPaths.sharedExchangeProtocol,
    sessionTitling: v2PromptAssetPaths.sessionTitling,
} as const;

export const listV2PromptAssets = (
    mode: SessionMode,
    isFirstExchange: boolean,
): readonly string[] => [
    v2PromptAssembly.shared,
    ...(isFirstExchange ? [v2PromptAssembly.sessionTitling] : []),
    v2PromptAssembly[mode],
];
