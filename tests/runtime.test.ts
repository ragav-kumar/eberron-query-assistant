import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createPlaceholderIngestionService } from '@/server/v1/ingestion/index.js';
import { createMemoryProgressReporter } from '@/server/v1/progress/reporter.js';
import { runStartupRefresh } from '@/server/v1/runtime/refresh.js';
import { createFilesystemSourceDiscoveryService, createPlaceholderSourceDiscoveryService } from '@/server/v1/source-discovery/index.js';
import { createFilesystemStateStore, createPlaceholderStateStore } from '@/server/v1/state/index.js';
import { createDefaultRuntimeState, type RuntimeState } from '@/server/v1/state/state-store.js';

const TEST_ROOT = path.resolve('.test-tmp', 'runtime');
const PLACEHOLDER_ROOT = path.resolve('.test-tmp', 'runtime-placeholder');

describe('startup refresh skeleton', () => {
  it('emits readable source inventory progress', async () => {
    const reporter = createMemoryProgressReporter();

    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: true }, {
      discovery: createPlaceholderSourceDiscoveryService(),
      ingestion: createPlaceholderIngestionService(),
      reporter,
      stateStore: createPlaceholderStateStore()
    });

    expect(reporter.messages).toContain('Starting source inventory checks.');
    expect(reporter.messages).toContain('Force re-ingest requested; source inventory will schedule all available sources.');
    expect(reporter.messages).toContain('Ingestion refresh complete.');
    expect(reporter.messages).toContain('Startup refresh complete.');
    expect(reporter.messages.some((message) => message.startsWith('foundry: placeholder inventory skipped.'))).toBe(
      true
    );
  });

  it('commits successful source inventory state during startup refresh', async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });

    try {
      const config = loadDefaultConfig(TEST_ROOT);
      const stateStore = createFilesystemStateStore();
      const initialState = createDefaultRuntimeState();
      initialState.article.lastSuccessfulIndexScrapeAt = '2026-04-24T10:00:00.000Z';

      await stateStore.save(config, initialState);
      await writeDeltaExport(config.foundryExportDir, '20260424T100000000Z-foundry-export.ndjson', 'run-1', 2);
      await mkdir(config.pdfDir, { recursive: true });
      await writeFile(path.join(config.pdfDir, 'rising.pdf'), '', 'utf8');

      const summary = await runStartupRefresh(config, { forceReingest: false }, {
        discovery: createFilesystemSourceDiscoveryService({ now: () => new Date('2026-04-24T12:00:00.000Z') }),
        ingestion: createPlaceholderIngestionService(),
        reporter: createMemoryProgressReporter(),
        stateStore
      });

      const persisted = await stateStore.load(config);

      expect(summary.degraded).toBe(false);
      expect(summary.degradedSources).toEqual([]);
      expect(persisted.state.foundry.lastSuccessfulExport).toEqual({
        deleteCount: 0,
        filename: '20260424T100000000Z-foundry-export.ndjson',
        generatedAt: '2026-04-24T10:00:00.000Z',
        recordCount: 2,
        runId: 'run-1',
        schemaVersion: '2.0.0',
        upsertCount: 2
      });
      expect(persisted.state.foundry.appliedExportFilenames).toEqual(['20260424T100000000Z-foundry-export.ndjson']);
      expect(persisted.state.pdf.knownFilenames).toEqual(['rising.pdf']);
      expect(persisted.state.article.lastSuccessfulIndexScrapeAt).toBe('2026-04-24T10:00:00.000Z');
    } finally {
      await rm(TEST_ROOT, { force: true, recursive: true });
    }
  });

  it('does not save runtime state when retrieval refresh fails', async () => {
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    nextState.pdf.knownFilenames = ['new.pdf'];
    const save = vi.fn<(_config: ReturnType<typeof loadDefaultConfig>, _state: RuntimeState) => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false }, {
        discovery: {
          inspectSources: vi.fn().mockResolvedValue({
            degraded: false,
            nextState,
            inventories: []
          })
        },
        ingestion: {
          ingest: vi.fn().mockResolvedValue({
            nextState,
            summary: {
              corpusSourceCount: 1,
              degraded: false,
              sourceSummaries: []
            }
          })
        },
        reporter: createMemoryProgressReporter(),
        retrieval: {
          prepare: vi.fn().mockResolvedValue(undefined),
          refresh: vi.fn().mockRejectedValue(new Error('simulated retrieval failure')),
          search: vi.fn().mockResolvedValue([])
        },
        stateStore: {
          load: vi.fn().mockResolvedValue({ state }),
          save
        }
      })
    ).rejects.toThrow('simulated retrieval failure');

    expect(save).not.toHaveBeenCalled();
  });

  it('does not save runtime state or refresh retrieval when ingestion leaves an empty corpus', async () => {
    const state = createDefaultRuntimeState();
    const save = vi.fn<(_config: ReturnType<typeof loadDefaultConfig>, _state: RuntimeState) => Promise<void>>().mockResolvedValue(undefined);
    const retrieval = {
      prepare: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({ chunkCount: 0, reusedEmbeddings: 0, regeneratedEmbeddings: 0 }),
      search: vi.fn().mockResolvedValue([])
    };

    await expect(
      runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false }, {
        discovery: {
          inspectSources: vi.fn().mockResolvedValue({
            degraded: false,
            nextState: state,
            inventories: []
          })
        },
        ingestion: {
          ingest: vi.fn().mockResolvedValue({
            nextState: state,
            summary: {
              corpusSourceCount: 0,
              degraded: true,
              sourceSummaries: []
            }
          })
        },
        reporter: createMemoryProgressReporter(),
        retrieval,
        stateStore: {
          load: vi.fn().mockResolvedValue({ state }),
          save
        }
      })
    ).rejects.toMatchObject({ kind: 'empty-corpus' });

    expect(retrieval.refresh).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('names degraded source types in startup output', async () => {
    const state = createDefaultRuntimeState();
    const reporter = createMemoryProgressReporter();

    const summary = await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false }, {
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: true,
          nextState: state,
          inventories: [
            {
              sourceType: 'foundry',
              discovered: 0,
              added: 0,
              updated: 0,
              removed: 0,
              failed: 1,
              status: 'failed',
              message: 'foundry: failed.',
              details: []
            },
            {
              sourceType: 'pdf',
              discovered: 1,
              added: 1,
              updated: 0,
              removed: 0,
              failed: 0,
              status: 'scheduled',
              message: 'pdf: scheduled.',
              details: []
            }
          ]
        })
      },
      ingestion: {
        ingest: vi.fn().mockResolvedValue({
          nextState: state,
          summary: {
            corpusSourceCount: 1,
            degraded: true,
            sourceSummaries: [
              {
                sourceType: 'foundry',
                status: 'skipped',
                discovered: 0,
                ingested: 0,
                removed: 0,
                failed: 0,
                message: 'foundry: ingestion skipped.',
                details: []
              },
              {
                sourceType: 'pdf',
                status: 'succeeded',
                discovered: 1,
                ingested: 0,
                removed: 0,
                failed: 1,
                message: 'pdf: ingestion completed with source-scoped failures.',
                details: ['new.pdf: parse failed']
              }
            ]
          }
        })
      },
      reporter,
      stateStore: createPlaceholderStateStore()
    });

    expect(summary.degraded).toBe(true);
    expect(summary.degradedSources).toEqual(['foundry', 'pdf']);
    expect(reporter.warnings.some((message) => message.includes('degradedSources=foundry, pdf'))).toBe(true);
    expect(reporter.warnings.some((message) => message.includes('foundry: discovery failed.'))).toBe(true);
    expect(reporter.warnings.some((message) => message.includes('pdf: partial ingestion failure.'))).toBe(true);
  });

  it('forces retrieval rebuild only for force re-ingest', async () => {
    const state = createDefaultRuntimeState();
    const nextState = createDefaultRuntimeState();
    const retrieval = {
      prepare: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 0, regeneratedEmbeddings: 1 }),
      search: vi.fn().mockResolvedValue([])
    };
    const dependencies = {
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: false,
          nextState,
          inventories: []
        })
      },
      ingestion: {
        ingest: vi.fn().mockResolvedValue({
          nextState,
          summary: {
            corpusSourceCount: 1,
            degraded: false,
            sourceSummaries: []
          }
        })
      },
      reporter: createMemoryProgressReporter(),
      retrieval,
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      }
    };

    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false }, dependencies);
    await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: true }, dependencies);

    expect(retrieval.refresh).toHaveBeenNthCalledWith(1, loadDefaultConfig(PLACEHOLDER_ROOT), {
      forceRebuild: false
    });
    expect(retrieval.refresh).toHaveBeenNthCalledWith(2, loadDefaultConfig(PLACEHOLDER_ROOT), {
      forceRebuild: true
    });
  });

  it('skips retrieval refresh when startup work found no source changes', async () => {
    const state = createDefaultRuntimeState();
    const retrieval = {
      prepare: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({ chunkCount: 1, reusedEmbeddings: 1, regeneratedEmbeddings: 0 }),
      search: vi.fn().mockResolvedValue([])
    };
    const reporter = createMemoryProgressReporter();

    const summary = await runStartupRefresh(loadDefaultConfig(PLACEHOLDER_ROOT), { forceReingest: false }, {
      discovery: {
        inspectSources: vi.fn().mockResolvedValue({
          degraded: false,
          nextState: state,
          inventories: [
            {
              sourceType: 'foundry',
              discovered: 1,
              added: 0,
              updated: 0,
              removed: 0,
              failed: 0,
              status: 'skipped',
              message: 'foundry: unchanged.',
              details: []
            }
          ]
        })
      },
      ingestion: {
        ingest: vi.fn().mockResolvedValue({
          nextState: state,
          summary: {
            corpusSourceCount: 1,
            degraded: false,
            sourceSummaries: [
              {
                sourceType: 'foundry',
                status: 'skipped',
                discovered: 0,
                ingested: 0,
                removed: 0,
                failed: 0,
                message: 'foundry: ingestion skipped.',
                details: []
              }
            ]
          }
        })
      },
      reporter,
      retrieval,
      stateStore: {
        load: vi.fn().mockResolvedValue({ state }),
        save: vi.fn().mockResolvedValue(undefined)
      }
    });

    expect(summary.retrieval).toBeUndefined();
    expect(retrieval.prepare).toHaveBeenCalledWith(loadDefaultConfig(PLACEHOLDER_ROOT));
    expect(retrieval.refresh).not.toHaveBeenCalled();
    expect(reporter.messages).toContain('Retrieval indexes already current; skipping retrieval refresh.');
  });
});

const writeDeltaExport = async (foundryExportDir: string, filename: string, runId: string, recordCount: number) => {
  await mkdir(foundryExportDir, { recursive: true });
  await writeFile(
    path.join(foundryExportDir, filename),
    `${JSON.stringify({
      kind: 'manifest',
      manifest: {
        schemaVersion: '2.0.0',
        run: {
          deleteCount: 0,
          generatedAt: '2026-04-24T10:00:00.000Z',
          recordCount,
          runId,
          upsertCount: recordCount
        }
      }
    })}\n`,
    'utf8'
  );
};
