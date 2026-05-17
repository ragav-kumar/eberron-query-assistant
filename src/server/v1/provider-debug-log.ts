import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PROVIDER_DEBUG_LOG_FILENAME = 'provider-debug.jsonl';
const DEFAULT_MAX_PROVIDER_DEBUG_LOG_LINES = 200;

export interface ProviderDebugLog {
  append(entry: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export const getProviderDebugLogPath = (runtimeDir: string): string => {
  return path.join(runtimeDir, PROVIDER_DEBUG_LOG_FILENAME);
};

export const createProviderDebugLog = (
  runtimeDir: string,
  options: { maxLines?: number } = {}
): ProviderDebugLog => {
  const filePath = getProviderDebugLogPath(runtimeDir);
  const maxLines = options.maxLines ?? DEFAULT_MAX_PROVIDER_DEBUG_LOG_LINES;
  let queue = Promise.resolve();

  const append = (entry: Record<string, unknown>): void => {
    const line = JSON.stringify(entry);
    queue = queue
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        const existingLines = maxLines > 1 ? await readExistingLines(filePath) : [];
        const nextLines =
          maxLines <= 0
            ? []
            : [...existingLines, line].slice(-maxLines);
        await writeFile(filePath, nextLines.length > 0 ? `${nextLines.join('\n')}\n` : '', 'utf8');
      })
      .catch(() => undefined);
  };

  return {
    append,
    async flush() {
      await queue;
    }
  };
};

const readExistingLines = async (filePath: string): Promise<string[]> => {
  try {
    const file = await readFile(filePath, 'utf8');
    return file
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
};

const isMissingFileError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
};
