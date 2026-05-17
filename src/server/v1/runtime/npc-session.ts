import type { ChatAdapter, ChatCompletionDiagnostic, ChatMessage } from '../provider/index.js';
import type { RetrievalService } from '../retrieval/index.js';
import { createNoopTimingReporter, type TimingContext } from '@/timing.js';
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from '@/types.js';
import { readGeneratedNpcState, updateGeneratedNpcState } from './npc-store.js';
import {
  formatCitation,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from './assistant-prompts.js';
import { createSqlitePartyContextService, type PartyContextService } from './party-context.js';
import {
  buildRetrievalToolInstructions,
  clampRetrievalTurnLimit,
  completeStructured,
  RETRIEVAL_TOOL,
  runRetrievalToolLoop
} from './retrieval-tool.js';

export interface GeneratedNpc {
  age?: string;
  bio: string;
  description: string;
  ethnicity?: string;
  gender?: string;
  id: number;
  name: string;
  role?: string;
  species?: string;
}

export interface NpcGenerationSession {
  generate(prompt: string, options?: NpcGenerationOptions): Promise<NpcGenerationAnswer>;
  read(): Promise<GeneratedNpc[]>;
  reset(): void;
}

export interface NpcGenerationOptions {
  includePartyContext?: boolean;
  onProviderDiagnostic?: (diagnostic: ChatCompletionDiagnostic) => void;
  retrievalTurnLimit?: number;
  timing?: TimingContext;
}

export interface NpcGenerationAnswer {
  evidence: RetrievalResult[];
  npcs: GeneratedNpc[];
}

export interface NpcGenerationSessionOptions {
  assistant: AssistantConfig;
  chat: ChatAdapter;
  config: RuntimeConfig;
  partyContext?: PartyContextService;
  reportStatus?(message: string): Promise<void> | void;
  retrieval: RetrievalService;
}

const MAX_EVIDENCE_RESULTS = 8;
const MAX_HISTORY_MESSAGES = 8;

export const createNpcGenerationSession = (options: NpcGenerationSessionOptions): NpcGenerationSession => {
  const history: ChatMessage[] = [];
  const partyContext = options.partyContext ?? createSqlitePartyContextService();
  let promptAssets: AssistantPromptAssets | null = null;

  const loadPromptAssets = async (): Promise<AssistantPromptAssets> => {
    promptAssets ??= await loadAssistantPromptAssets(options.assistant);
    return promptAssets;
  };

  return {
    async generate(prompt, generationOptions = {}) {
      const normalizedPrompt = prompt.trim();
      if (normalizedPrompt.length === 0) {
        throw new Error('NPC generation prompt cannot be empty.');
      }

      const includePartyContext = generationOptions.includePartyContext ?? true;
      const retrievalTurnLimit = clampRetrievalTurnLimit(generationOptions.retrievalTurnLimit ?? 1);
      const timing = generationOptions.timing ?? {
        operation: 'npcs',
        operationId: 'untracked',
        reporter: createNoopTimingReporter()
      };
      const evidence = await timing.reporter.time(timing, 'npcs.retrieval.search', () =>
        options.retrieval.search({
          query: normalizedPrompt,
          timing,
          limit: MAX_EVIDENCE_RESULTS
        })
      );
      const existingNpcs = await timing.reporter.time(timing, 'npcs.state.read', () =>
        readGeneratedNpcState(options.config)
      );
      const maxExistingId = readMaxNpcId(existingNpcs);
      const partyContextText = includePartyContext
        ? await timing.reporter.time(timing, 'npcs.party_context', () => partyContext.build(options.config))
        : '';
      const promptAssets = await timing.reporter.time(timing, 'npcs.prompt_assets', () => loadPromptAssets());
      const messages = buildNpcGenerationMessages({
        evidence,
        history,
        includePartyContext,
        maxExistingId,
        npcs: existingNpcs,
        partyContext: partyContextText,
        prompt: normalizedPrompt,
        promptAssets,
        retrievalToolInstructions: buildRetrievalToolInstructions(retrievalTurnLimit)
      });
      const response = await timing.reporter.time(timing, 'npcs.chat.complete', () => completeStructured(
        options.chat,
        messages,
        {
          debug: {
            operation: timing.operation,
            operationId: timing.operationId,
            purpose: 'npcs'
          },
          onDiagnostic: generationOptions.onProviderDiagnostic,
          ...(retrievalTurnLimit > 0 ? { tools: [RETRIEVAL_TOOL] } : {})
        }
      ));
      const completion = await runRetrievalToolLoop({
        chat: options.chat,
        initialMessages: messages,
        initialResponse: response,
        onProviderDiagnostic: generationOptions.onProviderDiagnostic,
        purpose: 'npcs',
        ...(options.reportStatus ? { reportStatus: (message: string) => options.reportStatus?.(message) } : {}),
        retrieval: options.retrieval,
        retrievalTurnLimit,
        timing
      });
      const returnedNpcs = await timing.reporter.time(timing, 'npcs.response.parse', () =>
        parseNpcGenerationResponseWithRepair({
          chat: options.chat,
          existingNpcs,
          messages: completion.messages,
          onProviderDiagnostic: generationOptions.onProviderDiagnostic,
          response: completion.responseText,
          timing
        })
      );
      const savedNpcs = await timing.reporter.time(timing, 'npcs.state.update', () =>
        updateGeneratedNpcState(options.config, returnedNpcs)
      );

      const structuredResponse = JSON.stringify({ npcs: returnedNpcs });
      history.push({ role: 'user', content: normalizedPrompt }, { role: 'assistant', content: structuredResponse });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_MESSAGES));

      return {
        evidence,
        npcs: readNpcList(savedNpcs)
      };
    },
    async read() {
      return readNpcList(await readGeneratedNpcState(options.config));
    },
    reset() {
      history.splice(0, history.length);
    }
  };
};

interface NpcMessageBuildRequest {
  evidence: RetrievalResult[];
  history: ChatMessage[];
  includePartyContext?: boolean;
  maxExistingId: number;
  npcs: GeneratedNpc[];
  partyContext?: string;
  prompt: string;
  promptAssets: AssistantPromptAssets;
  retrievalToolInstructions?: string;
}

export const buildNpcGenerationMessages = (request: NpcMessageBuildRequest): ChatMessage[] => {
  const includePartyContext = request.includePartyContext ?? true;
  const partyContext = includePartyContext ? (request.partyContext?.trim() ?? '') : '';
  const systemPromptParts = [
    request.promptAssets.systemPrompt,
    request.promptAssets.additionalContext.length > 0
      ? ['Additional assistant context:', request.promptAssets.additionalContext].join('\n')
      : '',
    includePartyContext ? '' : request.promptAssets.worldQueryingModePrompt,
    request.promptAssets.npcGeneratorPrompt.replaceAll('{{maxExistingId}}', String(request.maxExistingId)),
    request.retrievalToolInstructions?.trim() ?? ''
  ].filter((part) => part.length > 0);

  return [
    {
      role: 'system',
      content: systemPromptParts.join('\n\n')
    },
    ...request.history,
    {
      role: 'user',
      content: [
        partyContext,
        partyContext.length > 0 ? '' : '',
        'Retrieved evidence:',
        formatEvidenceForNpcPrompt(request.evidence),
        '',
        'Saved NPCs:',
        request.npcs.length > 0 ? JSON.stringify({ npcs: request.npcs }) : '[]',
        '',
        `Prompt: ${request.prompt}`
      ].filter((part, index) => part.length > 0 || (partyContext.length > 0 && index === 1)).join('\n')
    }
  ];
};

export const parseNpcGenerationResponse = (response: string, existingNpcs: GeneratedNpc[]): GeneratedNpc[] => {
  const parsed = JSON.parse(stripJsonCodeFence(response)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.npcs)) {
    throw new Error('NPC generation response must be JSON with an npcs array.');
  }

  const npcs = parsed.npcs.map(readGeneratedNpc);
  const maxExistingId = readMaxNpcId(existingNpcs);
  const existingIds = new Set(existingNpcs.map((npc) => npc.id));
  if (new Set(npcs.map((npc) => npc.id)).size !== npcs.length) {
    throw new Error('NPC generation response included duplicate ids.');
  }
  if (npcs.some((npc) => npc.id <= maxExistingId && !existingIds.has(npc.id))) {
    throw new Error('NPC generation response assigned a new NPC id below the current maximum id.');
  }

  return npcs;
};

interface ParseNpcGenerationResponseWithRepairRequest {
  chat: ChatAdapter;
  existingNpcs: GeneratedNpc[];
  messages: ChatMessage[];
  onProviderDiagnostic?: ((diagnostic: ChatCompletionDiagnostic) => void) | undefined;
  response: string;
  timing: TimingContext;
}

const parseNpcGenerationResponseWithRepair = async (
  request: ParseNpcGenerationResponseWithRepairRequest
): Promise<GeneratedNpc[]> => {
  try {
    return parseNpcGenerationResponse(request.response, request.existingNpcs);
  } catch (error) {
    if (!isMalformedNpcJsonError(error)) {
      throw error;
    }
    const repairedResponse = await request.chat.complete(
      [
        ...request.messages,
        { role: 'assistant', content: request.response },
        { role: 'user', content: buildNpcJsonRepairPrompt() }
      ],
      {
        debug: {
          operation: request.timing.operation,
          operationId: request.timing.operationId,
          purpose: 'npcs-json-repair'
        },
        onDiagnostic: request.onProviderDiagnostic
      }
    );
    return parseNpcGenerationResponse(repairedResponse, request.existingNpcs);
  }
};

const readGeneratedNpc = (value: unknown): GeneratedNpc => {
  const id = isRecord(value) ? value.id : null;
  if (
    !isRecord(value) ||
    typeof id !== 'number' ||
    !Number.isInteger(id) ||
    id <= 0 ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.bio !== 'string'
  ) {
    throw new Error('NPC generation response included an invalid NPC record.');
  }

  const npc = {
    id,
    name: value.name.trim(),
    ...readOptionalNpcDetails(value),
    description: value.description.trim(),
    bio: value.bio.trim()
  };
  if (npc.name.length === 0 || npc.description.length === 0 || npc.bio.length === 0) {
    throw new Error('NPC generation response included an empty NPC field.');
  }

  return npc;
};

const formatEvidenceForNpcPrompt = (results: RetrievalResult[]): string => {
  if (results.length === 0) {
    return 'No relevant retrieval results were found. Use general Eberron lore only when it is reasonable.';
  }

  return results
    .map((result, index) =>
      [
        `[${index + 1}] ${formatCitation(result)}`,
        `Match: ${result.matchKind}, score=${result.score.toFixed(3)}`,
        result.content
      ].join('\n')
    )
    .join('\n\n');
};

const readNpcList = (npcs: GeneratedNpc[]): GeneratedNpc[] =>
  npcs.map((npc) => ({
    ...readOptionalNpcDetails(npc),
    bio: npc.bio,
    description: npc.description,
    id: npc.id,
    name: npc.name
  }));

const OPTIONAL_NPC_DETAIL_KEYS = ['species', 'ethnicity', 'gender', 'role', 'age'] as const;
type OptionalNpcDetailKey = (typeof OPTIONAL_NPC_DETAIL_KEYS)[number];

const readOptionalNpcDetails = (value: Partial<Record<OptionalNpcDetailKey, unknown>>): Partial<GeneratedNpc> => {
  const details: Partial<GeneratedNpc> = {};

  for (const key of OPTIONAL_NPC_DETAIL_KEYS) {
    const detail = value[key];
    if (detail === undefined) {
      continue;
    }
    if (typeof detail !== 'string') {
      throw new Error('NPC generation response included an invalid NPC record.');
    }

    const normalized = detail.trim();
    if (normalized.length > 0) {
      details[key] = normalized;
    }
  }

  return details;
};

const readMaxNpcId = (npcs: GeneratedNpc[]): number => npcs.reduce((maxId, npc) => Math.max(maxId, npc.id), 0);

const stripJsonCodeFence = (response: string): string => {
  const trimmed = response.trim();
  const match = trimmed.match(/^```(?:json)?\s*(?<json>[\s\S]*?)\s*```$/i);
  return match?.groups?.json?.trim() ?? trimmed;
};

const buildNpcJsonRepairPrompt = (): string => [
  'Your previous response was not valid final NPC JSON.',
  'Return the same final NPC result again as strict JSON only.',
  'Use the exact shape {"npcs":[...]} with no Markdown fences and no commentary.'
].join('\n');

const isMalformedNpcJsonError = (error: unknown): boolean => {
  return error instanceof SyntaxError || (
    error instanceof Error &&
    error.message === 'NPC generation response must be JSON with an npcs array.'
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
