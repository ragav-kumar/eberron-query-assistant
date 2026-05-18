/* eslint-disable @typescript-eslint/no-deprecated */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import type { ChatAdapter } from '@/server/v1/provider/index.js';
import { type RetrievalService } from '@/server/v1/retrieval/index.js';
import {
  buildAssistantMessages,
  formatCitation,
  loadAssistantPromptAssets,
  type AssistantPromptAssets
} from '@/server/v1/runtime/assistant-prompts.js';
import { createAssistantSession } from '@/server/v1/runtime/assistant-session.js';
import { buildNpcGenerationMessages, createNpcGenerationSession } from '@/server/v1/runtime/npc-session.js';
import { createSessionLog, sanitizeSessionTitle, type SessionLog } from '@/server/v1/runtime/session-log.js';
import type { AssistantConfig, RetrievalResult, RuntimeConfig } from '@/types.js';

const TEST_ROOT = path.resolve('.test-tmp', 'prompt');
const PROMPT_ASSETS: AssistantPromptAssets = {
  additionalContext: '',
  npcGeneratorPrompt: [
    'You are in NPC generator mode.',
    'For new NPCs, ids must be greater than {{maxExistingId}}.'
  ].join('\n'),
  sessionTitlePrompt: [
    'Return exactly this metadata wrapper before every answer.',
    'For the first response in a session only, include <session-title> as a concise human-readable session title of at most 8 words. Use normal words with spaces, not kebab-case, snake_case, PascalCase, camelCase, or file-name style. Omit <session-title> on later responses.',
    '<session-title>A concise human-readable session title</session-title>',
    '<response-title>A concise heading for this user prompt</response-title>',
    '<answer>',
    'Your normal answer.',
    '</answer>'
  ].join('\n'),
  systemPrompt: [
    'You are Eberron Query Assistant, a local browser-based assistant for Eberron lore and campaign notes.',
    'Answer using the retrieved evidence when it is relevant.',
    'Distinguish direct support from inference. Do not describe synthesized conclusions as quoted facts.',
    'Include concise references when evidence is available.',
    'Use PDF title plus page when present, article title plus URL, and foundry entity name plus type or identifier.'
  ].join('\n'),
  worldQueryingModePrompt: [
    'Party context is intentionally omitted.',
    'Treat this request as world querying or world building, not as a question about the current party, current session status, or active party goals.'
  ].join('\n')
};

afterEach(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
});

describe('assistant prompt assembly', () => {
  it('asks for readable session titles instead of machine-case filenames', () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: 'What is happening in the Mournland?',
      requestSessionTitle: true
    });

    expect(messages[0]?.content).toContain('human-readable session title');
    expect(messages[0]?.content).toContain('not kebab-case, snake_case, PascalCase, camelCase');
    expect(messages[0]?.content).not.toContain('filesystem-safe session title');
  });

  it('separates instructions, evidence, and user question', () => {
    const messages = buildAssistantMessages({
      evidence: [result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')],
      promptAssets: PROMPT_ASSETS,
      question: 'What does Aerenal do with deathless ancestors?'
    });

    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Distinguish direct support from inference');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Retrieved evidence:');
    expect(messages[1]?.content).toContain('Question: What does Aerenal do with deathless ancestors?');
    expect(messages[1]?.content).toContain('Eberron Rising, page 4');
  });

  it('formats mixed citation types', () => {
    expect(formatCitation(result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4'))).toBe(
      'Eberron Rising, page 4 [pdf:eberron.pdf]'
    );
    expect(
      formatCitation(
        result('article', 'https://keith-baker.com/aerenal/', 'Aerenal Notes', null, 'https://keith-baker.com/aerenal/')
      )
    ).toBe('Aerenal Notes, https://keith-baker.com/aerenal/ [article:https://keith-baker.com/aerenal/]');
    expect(formatCitation(result('foundry', 'actor-ashana', 'Ashana', 'Actor'))).toBe(
      'Ashana, Actor [foundry:actor-ashana]'
    );
  });

  it('tells the model when no evidence was retrieved', () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: 'What is unknown?'
    });

    expect(messages.at(-1)?.content).toContain('No relevant retrieval results were found');
  });

  it('includes non-empty local assistant context in the system message', () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: {
        ...PROMPT_ASSETS,
        additionalContext: 'The campaign treats Vathirond as politically tense.'
      },
      question: 'What is happening in Vathirond?'
    });

    expect(messages[0]?.content).toContain('Additional assistant context:');
    expect(messages[0]?.content).toContain('The campaign treats Vathirond as politically tense.');
  });

  it('includes current party context before retrieved evidence', () => {
    const messages = buildAssistantMessages({
      evidence: [result('foundry', 'world.actor.peanunt', 'Peanunt', 'Actor')],
      partyContext: 'Current party context:\n- Party actors: Peanunt.',
      promptAssets: PROMPT_ASSETS,
      question: 'Who is the party?'
    });

    expect(messages.at(-1)?.content).toContain('Current party context:');
    expect(messages.at(-1)?.content.indexOf('Current party context:')).toBeLessThan(
      messages.at(-1)?.content.indexOf('Retrieved evidence:') ?? 0
    );
  });

  it('omits party context and adds world querying instructions when party context is disabled', () => {
    const messages = buildAssistantMessages({
      evidence: [result('foundry', 'world.actor.peanunt', 'Peanunt', 'Actor')],
      includePartyContext: false,
      partyContext: 'Current party context:\n- Party actors: Peanunt.',
      promptAssets: PROMPT_ASSETS,
      question: 'Who runs Aundair?'
    });

    expect(messages[0]?.content).toContain('world querying or world building');
    expect(messages.at(-1)?.content).not.toContain('Current party context:');
    expect(messages.at(-1)?.content).toContain('Retrieved evidence:');
  });

  it('omits the local assistant context section when it is empty', () => {
    const messages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: 'What is happening in Vathirond?'
    });

    expect(messages[0]?.content).not.toContain('Additional assistant context:');
  });

  it('uses the session title prompt only when requested', () => {
    const normalMessages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: 'Normal question'
    });
    const firstResponseMessages = buildAssistantMessages({
      evidence: [],
      promptAssets: PROMPT_ASSETS,
      question: 'First question',
      requestSessionTitle: true
    });

    expect(normalMessages[0]?.content).toContain('omit <session-title>');
    expect(normalMessages[0]?.content).toContain('<response-title>');
    expect(firstResponseMessages[0]?.content).toContain('<session-title>');
    expect(firstResponseMessages[0]?.content).toContain('include <session-title>');
  });

  it('loads prompt text from assistant files and creates missing local context', async () => {
    const assistant = await writeAssistantFiles('load-assets', {
      additionalContext: null,
      systemPrompt: 'System prompt from disk.'
    });

    const loaded = await loadAssistantPromptAssets(assistant);

    expect(loaded.systemPrompt).toBe('System prompt from disk.');
    expect(loaded.sessionTitlePrompt).toContain('<session-title>');
    expect(loaded.npcGeneratorPrompt).toContain('NPC generator mode');
    expect(loaded.worldQueryingModePrompt).toContain('world querying or world building');
    expect(loaded.additionalContext).toBe('');
    await expect(readFile(assistant.additionalContextPath, 'utf8')).resolves.toBe('');
  });
});

describe('NPC generator prompt assembly', () => {
  it('includes current party context before retrieved evidence when enabled', () => {
    const messages = buildNpcGenerationMessages({
      evidence: [result('foundry', 'world.actor.peanunt', 'Peanunt', 'Actor')],
      history: [],
      includePartyContext: true,
      maxExistingId: 0,
      npcs: [],
      partyContext: 'Current party context:\n- Party actors: Peanunt.',
      prompt: 'Generate one NPC',
      promptAssets: PROMPT_ASSETS
    });

    expect(messages.at(-1)?.content).toContain('Current party context:');
    expect(messages.at(-1)?.content.indexOf('Current party context:')).toBeLessThan(
      messages.at(-1)?.content.indexOf('Retrieved evidence:') ?? 0
    );
  });

  it('omits party context and adds world building instructions when disabled', () => {
    const messages = buildNpcGenerationMessages({
      evidence: [result('foundry', 'world.actor.peanunt', 'Peanunt', 'Actor')],
      history: [],
      includePartyContext: false,
      maxExistingId: 0,
      npcs: [],
      partyContext: 'Current party context:\n- Party actors: Peanunt.',
      prompt: 'Generate one NPC',
      promptAssets: PROMPT_ASSETS
    });

    expect(messages[0]?.content).toContain('world querying or world building');
    expect(messages.at(-1)?.content).not.toContain('Current party context:');
    expect(messages.at(-1)?.content).toContain('Retrieved evidence:');
  });
});

describe('NPC generation session', () => {
  it('handles one retrieval tool call before the final NPC JSON', async () => {
    const config = loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-tool-loop'));
    const search = vi
      .fn<RetrievalService['search']>()
      .mockResolvedValueOnce([result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')])
      .mockResolvedValueOnce([result('article', 'aerenal-rites', 'Aerenal Rites', null, 'https://example.test/aerenal')]);
    const reportStatus = vi.fn();
    const completeStructured = vi
      .fn<NonNullable<ChatAdapter['completeStructured']>>()
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              limit: 2,
              query: 'aerenal patrons',
              sourceTypes: ['article'],
              userMessage: 'Checking article evidence for an Aerenal patron.'
            }),
            id: 'tool-1',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          npcs: [{ id: 1, name: 'Taela', description: 'An elf patron.', bio: 'She sponsors expeditions.' }]
        }),
        kind: 'text'
      });

    const response = await createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-tool-loop'),
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      config,
      reportStatus,
      retrieval: {
        prepare: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
        search
      }
    }).generate('Generate one Aereni patron.', { retrievalTurnLimit: 1 });

    expect(search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      limit: 8,
      query: 'Generate one Aereni patron.'
    }));
    expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 2,
      query: 'aerenal patrons',
      sourceTypes: ['article']
    }));
    expect(reportStatus).toHaveBeenCalledWith(
      'Assistant called search_corpus (turn 1/1): Checking article evidence for an Aerenal patron.'
    );
    expect(response.npcs).toEqual([
      { id: 1, name: 'Taela', description: 'An elf patron.', bio: 'She sponsors expeditions.' }
    ]);
    expect(completeStructured.mock.calls[0]?.[1]?.tools).toHaveLength(1);
  });

  it('preserves single-pass NPC behavior when retrieval turn limit is zero', async () => {
    const completeStructured = vi.fn<NonNullable<ChatAdapter['completeStructured']>>().mockResolvedValue({
      content: JSON.stringify({
        npcs: [{ id: 1, name: 'Doran', description: 'A veteran scout.', bio: 'He favors the borderlands.' }]
      }),
      kind: 'text'
    });

    await createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-tool-limit-zero'),
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      config: loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-tool-limit-zero')),
      retrieval: mockRetrieval([]).retrieval
    }).generate('Generate one scout.', { retrievalTurnLimit: 0 });

    expect(completeStructured.mock.calls[0]?.[1]?.tools).toBeUndefined();
  });

  it('repairs malformed NPC JSON once before saving state', async () => {
    const config = loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-json-repair'));
    const complete = vi
      .fn<ChatAdapter['complete']>()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({
        npcs: [{ id: 1, name: 'Sola', description: 'A quiet artificer.', bio: 'She studies schema fragments.' }]
      }));

    const response = await createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-json-repair'),
      chat: { complete },
      config,
      retrieval: mockRetrieval([]).retrieval
    }).generate('Generate one artificer.');

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].at(-1)?.content).toContain('strict JSON only');
    expect(response.npcs).toEqual([
      { id: 1, name: 'Sola', description: 'A quiet artificer.', bio: 'She studies schema fragments.' }
    ]);
  });

  it('returns a no-more-turns tool result when the NPC tool loop exceeds the limit', async () => {
    const completeStructured = vi
      .fn<NonNullable<ChatAdapter['completeStructured']>>()
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              query: 'first pass',
              userMessage: 'Checking one lead.'
            }),
            id: 'tool-1',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              query: 'second pass',
              userMessage: 'Checking one more lead.'
            }),
            id: 'tool-2',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          npcs: [{ id: 1, name: 'Ilan', description: 'A wary envoy.', bio: 'He survives on old favors.' }]
        }),
        kind: 'text'
      });

    await createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-tool-limit-hit'),
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      config: loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-tool-limit-hit')),
      retrieval: mockRetrieval([]).retrieval
    }).generate('Generate one envoy.', { retrievalTurnLimit: 1 });

    expect(completeStructured.mock.calls[1]?.[0].some((message) =>
      message.role === 'tool' &&
      message.content.includes('No more retrieval turns are available')
    )).toBe(true);
  });

  it('returns a tool error for invalid NPC retrieval arguments without consuming a turn', async () => {
    const search = vi
      .fn<RetrievalService['search']>()
      .mockResolvedValueOnce([result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')])
      .mockResolvedValueOnce([result('article', 'valid-follow-up', 'Valid Follow Up', null, 'https://example.test/follow-up')]);
    const completeStructured = vi
      .fn<NonNullable<ChatAdapter['completeStructured']>>()
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              userMessage: 'Missing query.'
            }),
            id: 'tool-1',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              query: 'valid follow up',
              userMessage: 'Checking a valid follow-up.'
            }),
            id: 'tool-2',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          npcs: [{ id: 1, name: 'Sera', description: 'A discreet courier.', bio: 'She trades in secrets.' }]
        }),
        kind: 'text'
      });

    await createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-tool-invalid-args'),
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      config: loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-tool-invalid-args')),
      retrieval: {
        prepare: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
        search
      }
    }).generate('Generate one courier.', { retrievalTurnLimit: 1 });

    expect(search).toHaveBeenCalledTimes(2);
    expect(completeStructured.mock.calls[1]?.[0].some((message) =>
      message.role === 'tool' &&
      message.content.includes('Tool error: query is required.')
    )).toBe(true);
  });

  it('fails when the NPC JSON repair pass still returns invalid records', async () => {
    const complete = vi
      .fn<ChatAdapter['complete']>()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({
        npcs: [{ id: 1, name: 'Broken', species: 42, description: 'Invalid NPC.', bio: 'Still invalid.' }]
      }));

    await expect(createNpcGenerationSession({
      assistant: await writeAssistantFiles('npc-json-repair-invalid'),
      chat: { complete },
      config: loadDefaultConfig(path.join(TEST_ROOT, 'runtime', 'npc-json-repair-invalid')),
      retrieval: mockRetrieval([]).retrieval
    }).generate('Generate one broken NPC.')).rejects.toThrow('NPC generation response included an invalid NPC record.');
  });
});

describe('assistant session', () => {
  it('retrieves evidence, repairs metadata, and appends a transcript exchange', async () => {
    const retrievalFixture = mockRetrieval([result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')]);
    const complete = vi
      .fn<ChatAdapter['complete']>()
      .mockResolvedValueOnce('Aerenal answer.\nReferences: Eberron Rising, page 4')
      .mockResolvedValueOnce([
        '<session-title>Aerenal</session-title>',
        '<response-title>Aerenal Answer</response-title>',
        '<answer>',
        'Aerenal answer.',
        'References: Eberron Rising, page 4',
        '</answer>'
      ].join('\n'));
    const appendExchange = vi.fn();

    const answer = await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('retrieves-evidence')),
      appendProgress: vi.fn(),
      appendExchange,
      chat: { complete },
      retrieval: retrievalFixture.retrieval
    }).ask('What about Aerenal?');

    expect(retrievalFixture.search).toHaveBeenCalledWith(expect.objectContaining({
      query: 'What about Aerenal?',
      limit: 8
    }));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(answer.answer).toBe('Aerenal answer.\nReferences: Eberron Rising, page 4');
    expect(appendExchange).toHaveBeenCalledWith({
      assistant: 'Aerenal answer.\nReferences: Eberron Rising, page 4',
      sessionTitle: 'Aerenal',
      title: 'Aerenal Answer',
      user: 'What about Aerenal?'
    });
  });

  it('creates a session transcript from first response title metadata', async () => {
    const logDir = path.join(TEST_ROOT, 'logs-title');
    const complete = vi.fn<ChatAdapter['complete']>().mockResolvedValue(
      [
        '<session-title>Aerenal Ancestors</session-title>',
        '<response-title>Aerenal Ancestors</response-title>',
        '<answer>',
        'Aerenal answer.',
        'References: Eberron Rising, page 4',
        '</answer>'
      ].join('\n')
    );

    await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-title')),
      appendProgress: vi.fn(),
      appendExchange: createTranscriptAppender(logDir),
      chat: { complete },
      retrieval: mockRetrieval([result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')]).retrieval
    }).ask('What about Aerenal?');

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);
    expect(filenames[0]).toMatch(/^\d{14} Aerenal Ancestors\.json$/);

    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ''), 'utf8')) as unknown;
    expect(log).toEqual([
      {
        kind: 'exchange',
        user: 'What about Aerenal?',
        title: 'Aerenal Ancestors',
        assistant: 'Aerenal answer.\nReferences: Eberron Rising, page 4'
      }
    ]);
  });

  it('appends later successful responses to the same session transcript', async () => {
    const logDir = path.join(TEST_ROOT, 'logs-append');
    const complete = vi
      .fn<ChatAdapter['complete']>()
      .mockResolvedValueOnce('<session-title>Dragonmark Notes</session-title>\n<response-title>First Question</response-title>\n<answer>\nFirst answer.\n</answer>')
      .mockResolvedValueOnce('<response-title>Second Question</response-title>\n<answer>\nSecond answer.\n</answer>');
    const session = createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-append')),
      appendProgress: vi.fn(),
      appendExchange: createTranscriptAppender(logDir),
      chat: { complete },
      retrieval: mockRetrieval([]).retrieval
    });

    await session.ask('First question');
    await session.ask('Second question');

    const filenames = await readdir(logDir);
    expect(filenames).toHaveLength(1);

    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ''), 'utf8')) as Array<{
      assistant: string;
      title: string;
      user: string;
    }>;
    expect(log).toEqual([
      { kind: 'exchange', user: 'First question', title: 'First Question', assistant: 'First answer.' },
      { kind: 'exchange', user: 'Second question', title: 'Second Question', assistant: 'Second answer.' }
    ]);
  });

  it('does not create a session transcript when title metadata is missing', async () => {
    const logDir = path.join(TEST_ROOT, 'logs-missing-title');

    await expect(createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-missing-title')),
      appendProgress: vi.fn(),
      appendExchange: createTranscriptAppender(logDir),
      chat: { complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('Plain answer.') },
      retrieval: mockRetrieval([]).retrieval
    }).ask('What/about:Aerenal?')).rejects.toThrow('Assistant response did not include required title metadata.');

    await expect(readdir(logDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs missing title metadata before appending a later transcript exchange', async () => {
    const logDir = path.join(TEST_ROOT, 'logs-title-repair');
    const complete = vi
      .fn<ChatAdapter['complete']>()
      .mockResolvedValueOnce('<session-title>Crafting</session-title>\n<response-title>Setup</response-title>\n<answer>\nFirst answer.\n</answer>')
      .mockResolvedValueOnce('Second answer without tags.')
      .mockResolvedValueOnce('<response-title>Materials</response-title>\n<answer>\nSecond answer without tags.\n</answer>');
    const session = createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-title-repair')),
      appendProgress: vi.fn(),
      appendExchange: createTranscriptAppender(logDir),
      chat: { complete },
      retrieval: mockRetrieval([]).retrieval
    });

    await session.ask('First question');
    await session.ask('Second question');

    const filenames = await readdir(logDir);
    const log = JSON.parse(await readFile(path.join(logDir, filenames[0] ?? ''), 'utf8')) as Array<{
      assistant: string;
      title: string;
      user: string;
    }>;
    expect(log[1]).toEqual({
      kind: 'exchange',
      user: 'Second question',
      title: 'Materials',
      assistant: 'Second answer without tags.'
    });
  });

  it('starts each session with empty in-memory history', async () => {
    const firstChat = mockChat();
    const secondChat = mockChat();
    const logDir = path.join(TEST_ROOT, 'logs-history');
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, '20260102030405 Old Session.json'), JSON.stringify([{ user: 'Old logged question', title: 'Old', assistant: 'Old answer' }]), 'utf8');

    await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-history-first')),
      appendProgress: vi.fn(),
      appendExchange: vi.fn(),
      chat: firstChat.chat,
      retrieval: mockRetrieval([]).retrieval
    }).ask('First question');
    await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('logs-history-second')),
      appendProgress: vi.fn(),
      appendExchange: vi.fn(),
      chat: secondChat.chat,
      retrieval: mockRetrieval([]).retrieval
    }).ask('Second question');

    const firstMessages = firstChat.complete.mock.calls[0]?.[0] ?? [];
    const secondMessages = secondChat.complete.mock.calls[0]?.[0] ?? [];
    expect(firstMessages.some((message) => message.content.includes('First question'))).toBe(true);
    expect(secondMessages.some((message) => message.content.includes('First question'))).toBe(false);
    expect(secondMessages.some((message) => message.content.includes('Old logged question'))).toBe(false);
  });

  it('handles one retrieval tool call before the final assistant answer', async () => {
    const search = vi
      .fn<RetrievalService['search']>()
      .mockResolvedValueOnce([result('pdf', 'eberron.pdf', 'Eberron Rising', 'page 4')])
      .mockResolvedValueOnce([result('article', 'aerenal-rites', 'Aerenal Rites', null, 'https://example.test/aerenal')]);
    const appendExchange = vi.fn();
    const appendProgress = vi.fn();
    const reportStatus = vi.fn();
    const completeStructured = vi
      .fn<NonNullable<ChatAdapter['completeStructured']>>()
      .mockResolvedValueOnce({
        content: '',
        kind: 'tool-calls',
        toolCalls: [
          {
            arguments: JSON.stringify({
              limit: 2,
              query: 'aerenal death rites',
              sourceTypes: ['article'],
              userMessage: 'Checking article evidence about Aerenal rites.'
            }),
            id: 'tool-1',
            name: 'search_corpus'
          }
        ]
      })
      .mockResolvedValueOnce({
        content: [
          '<session-title>Aerenal Rites</session-title>',
          '<response-title>Aerenal Rites</response-title>',
          '<answer>',
          'Aerenal answer with article support.',
          '</answer>'
        ].join('\n'),
        kind: 'text'
      });

    const answer = await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('tool-loop')),
      appendProgress,
      appendExchange,
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      reportStatus,
      retrieval: {
        prepare: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
        search
      }
    }).ask('What rites do the Aereni use?', { retrievalTurnLimit: 1 });

    expect(search).toHaveBeenNthCalledWith(1, expect.objectContaining({
      limit: 8,
      query: 'What rites do the Aereni use?'
    }));
    expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 2,
      query: 'aerenal death rites',
      sourceTypes: ['article']
    }));
    expect(appendProgress).toHaveBeenCalledWith({
      kind: 'progress',
      message: 'Checking article evidence about Aerenal rites.'
    });
    expect(reportStatus).toHaveBeenCalledWith(
      'Assistant called search_corpus (turn 1/1): Checking article evidence about Aerenal rites.'
    );
    expect(answer.answer).toBe('Aerenal answer with article support.');
    expect(appendExchange).toHaveBeenCalledWith({
      assistant: 'Aerenal answer with article support.',
      sessionTitle: 'Aerenal Rites',
      title: 'Aerenal Rites',
      user: 'What rites do the Aereni use?'
    });
    expect(completeStructured.mock.calls[0]?.[1]?.tools).toHaveLength(1);
  });

  it('preserves single-pass behavior when retrieval turn limit is zero', async () => {
    const completeStructured = vi.fn<NonNullable<ChatAdapter['completeStructured']>>().mockResolvedValue({
      content: '<session-title>Single Pass</session-title>\n<response-title>Single Pass</response-title>\n<answer>\nAnswer.\n</answer>',
      kind: 'text'
    });

    await createAssistantSession({
      ...assistantSessionConfig(await writeAssistantFiles('tool-limit-zero')),
      appendProgress: vi.fn(),
      appendExchange: vi.fn(),
      chat: {
        complete: vi.fn<ChatAdapter['complete']>().mockResolvedValue('unused'),
        completeStructured
      },
      retrieval: mockRetrieval([]).retrieval
    }).ask('Answer in one pass.', { retrievalTurnLimit: 0 });

    expect(completeStructured.mock.calls[0]?.[1]?.tools).toBeUndefined();
  });
});

describe('session title sanitization', () => {
  it('turns machine-case assistant titles into readable words', () => {
    expect(sanitizeSessionTitle('mournland-overview')).toBe('Mournland Overview');
    expect(sanitizeSessionTitle('dragonmark_research_notes')).toBe('Dragonmark Research Notes');
    expect(sanitizeSessionTitle('MOURNLAND_OVERVIEW')).toBe('Mournland Overview');
    expect(sanitizeSessionTitle('MournlandOverview')).toBe('Mournland Overview');
    expect(sanitizeSessionTitle('mournlandOverview')).toBe('Mournland Overview');
  });

  it('preserves already-readable assistant titles while removing unsafe filename characters', () => {
    expect(sanitizeSessionTitle('Aerenal and the Undying Court')).toBe('Aerenal and the Undying Court');
    expect(sanitizeSessionTitle('What/about:Aerenal?')).toBe('What about Aerenal');
  });
});

const result = (
  sourceType: RetrievalResult['sourceType'],
  sourceKey: string,
  label: string,
  locator: string | null,
  url: string | null = null
): RetrievalResult => ({
  chunkId: `${sourceType}:${sourceKey}:0`,
  sourceId: `${sourceType}:${sourceKey}`,
  sourceType,
  sourceKey,
  sourceTitle: label,
  content: 'Aerenal keeps deathless counselors.',
  citation: {
    sourceType,
    label,
    locator,
    url
  },
  score: 0.9,
  matchKind: 'hybrid'
});

const mockRetrieval = (
  results: RetrievalResult[]
): { retrieval: RetrievalService; search: ReturnType<typeof vi.fn<RetrievalService['search']>> } => {
  const search = vi.fn<RetrievalService['search']>().mockResolvedValue(results);
  return {
    retrieval: {
      prepare: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({ chunkCount: results.length, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
      search
    },
    search
  };
};

const mockChat = (): { chat: ChatAdapter; complete: ReturnType<typeof vi.fn<ChatAdapter['complete']>> } => {
  const complete = vi.fn<ChatAdapter['complete']>().mockResolvedValue(
    '<session-title>Answer Session</session-title>\n<response-title>Answer</response-title>\n<answer>\nanswer\n</answer>'
  );
  return {
    chat: {
      complete
    },
    complete
  };
};

const writeAssistantFiles = async (
  name: string,
  options: {
    additionalContext?: string | null;
    sessionTitlePrompt?: string;
    systemPrompt?: string;
  } = {}
): Promise<AssistantConfig> => {
  const assistantDir = path.join(TEST_ROOT, 'assistant', name);
  const config: AssistantConfig = {
    assistantDir,
    additionalContextPath: path.join(assistantDir, 'additional-context.md'),
    npcGeneratorPromptPath: path.join(assistantDir, 'npc-generator-prompt.md'),
    sessionTitlePromptPath: path.join(assistantDir, 'session-title-prompt.md'),
    systemPromptPath: path.join(assistantDir, 'system-prompt.md'),
    worldQueryingModePromptPath: path.join(assistantDir, 'world-querying-mode-prompt.md')
  };
  await mkdir(assistantDir, { recursive: true });
  await writeFile(config.systemPromptPath, options.systemPrompt ?? PROMPT_ASSETS.systemPrompt, 'utf8');
  await writeFile(config.npcGeneratorPromptPath, PROMPT_ASSETS.npcGeneratorPrompt, 'utf8');
  await writeFile(config.worldQueryingModePromptPath, PROMPT_ASSETS.worldQueryingModePrompt, 'utf8');
  await writeFile(
    config.sessionTitlePromptPath,
    options.sessionTitlePrompt ?? PROMPT_ASSETS.sessionTitlePrompt,
    'utf8'
  );
  if (options.additionalContext !== null) {
    await writeFile(config.additionalContextPath, options.additionalContext ?? '', 'utf8');
  }
  return config;
};

const assistantSessionConfig = (assistant: AssistantConfig): { assistant: AssistantConfig; config: RuntimeConfig } => {
  const config = loadDefaultConfig(path.join(TEST_ROOT, 'runtime', path.basename(assistant.assistantDir)));
  return {
    assistant,
    config: {
      ...config,
      assistant
    }
  };
};

const createTranscriptAppender = (logDir: string): (exchange: {
  assistant: string;
  sessionTitle: string;
  title: string;
  user: string;
}) => Promise<void> => {
  let log: SessionLog | null = null;

  return async (exchange) => {
    log ??= await createSessionLog({
      logDir,
      title: exchange.sessionTitle
    });
    await log.append({
      assistant: exchange.assistant,
      kind: 'exchange',
      title: exchange.title,
      user: exchange.user
    });
  };
};
