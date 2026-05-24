import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionMode } from '@/types.js';

const promptsDirectory = path.dirname(fileURLToPath(import.meta.url));

const promptAssetPaths = {
    sharedExchangeProtocol: path.join(promptsDirectory, 'shared-exchange-protocol.md'),
    assistantMode: path.join(promptsDirectory, 'mode-assistant.md'),
    npcMode: path.join(promptsDirectory, 'mode-npc.md'),
    sessionTitling: path.join(promptsDirectory, 'session-titling.md'),
} as const;

const promptAssembly = {
    assistant: promptAssetPaths.assistantMode,
    npc: promptAssetPaths.npcMode,
    shared: promptAssetPaths.sharedExchangeProtocol,
    sessionTitling: promptAssetPaths.sessionTitling,
} as const;

export const listPromptAssets = (
    mode: SessionMode,
    isFirstExchange: boolean,
): readonly string[] => [
    promptAssembly.shared,
    ...(isFirstExchange ? [promptAssembly.sessionTitling] : []),
    promptAssembly[mode],
];
