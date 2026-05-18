import { appendFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

export interface TimingContext {
  operation: string;
  operationId: string;
  reporter: TimingReporter;
}

export interface TimingReporter {
  time<T>(context: TimingContext, label: string, task: () => T | Promise<T>): Promise<T>;
}

export interface JsonlTimingReporterOptions {
  filePath?: string;
  repoRoot: string;
}

interface TimingEntry {
  durationMs: number;
  endedAt: string;
  label: string;
  ok: boolean;
  operation: string;
  operationId: string;
  startedAt: string;
}

export const createNoopTimingReporter = (): TimingReporter => ({
  time: async (_context, _label, task) => task()
});

export const createJsonlTimingReporter = (options: JsonlTimingReporterOptions): TimingReporter => {
  const filePath = options.filePath ?? path.join(options.repoRoot, '.test-tmp', 'timing.jsonl');
  let queue = Promise.resolve();

  const append = async (entry: TimingEntry): Promise<void> => {
    queue = queue
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      })
      .catch(() => undefined);
    await queue;
  };

  return {
    time: async (context, label, task) => {
      const startedAt = new Date();
      const startedMs = performance.now();
      try {
        const result = await task();
        await append({
          durationMs: Math.round((performance.now() - startedMs) * 1000) / 1000,
          endedAt: new Date().toISOString(),
          label,
          ok: true,
          operation: context.operation,
          operationId: context.operationId,
          startedAt: startedAt.toISOString()
        });
        return result;
      } catch (error) {
        await append({
          durationMs: Math.round((performance.now() - startedMs) * 1000) / 1000,
          endedAt: new Date().toISOString(),
          label,
          ok: false,
          operation: context.operation,
          operationId: context.operationId,
          startedAt: startedAt.toISOString()
        });
        throw error;
      }
    }
  };
};
