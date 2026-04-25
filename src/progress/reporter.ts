export interface ProgressReporter {
  info(message: string): void;
  warn(message: string): void;
}

export interface MemoryProgressReporter extends ProgressReporter {
  readonly messages: string[];
  readonly warnings: string[];
}

export function createConsoleProgressReporter(): ProgressReporter {
  return {
    info(message) {
      console.log(message);
    },

    warn(message) {
      console.warn(message);
    }
  };
}

export function createMemoryProgressReporter(): MemoryProgressReporter {
  const messages: string[] = [];
  const warnings: string[] = [];

  return {
    messages,
    warnings,
    info(message) {
      messages.push(message);
    },
    warn(message) {
      warnings.push(message);
    }
  };
}
