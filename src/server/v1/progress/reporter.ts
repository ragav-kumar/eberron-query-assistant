export interface ProgressReporter {
  info(message: string): void;
  warn(message: string): void;
  progress?(message: string): void;
}

export interface MemoryProgressReporter extends ProgressReporter {
  readonly messages: string[];
  readonly warnings: string[];
}

export const createConsoleProgressReporter = (): ProgressReporter => {
  const colorsEnabled = shouldUseColor();
  const rewriteProgress = shouldRewriteProgress();
  let hasActiveProgress = false;
  let activeProgressRows = 0;

  const clearActiveProgress = (): void => {
    if (!hasActiveProgress) {
      return;
    }

    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);

    for (let row = 1; row < activeProgressRows; row += 1) {
      process.stdout.moveCursor(0, -1);
      process.stdout.clearLine(0);
    }

    process.stdout.cursorTo(0);
    hasActiveProgress = false;
    activeProgressRows = 0;
  };

  return {
    info(message) {
      clearActiveProgress();
      console.log(formatInfoMessage(message, colorsEnabled));
    },

    warn(message) {
      clearActiveProgress();
      console.warn(formatWarningMessage(message, colorsEnabled));
    },

    progress(message) {
      const formatted = formatInfoMessage(message, colorsEnabled);
      if (!rewriteProgress) {
        console.log(formatted);
        return;
      }

      clearActiveProgress();
      process.stdout.write(formatted);
      hasActiveProgress = true;
      activeProgressRows = countRenderedRows(formatted, process.stdout.columns);
    }
  };
};

export const createMemoryProgressReporter = (): MemoryProgressReporter => {
  const messages: string[] = [];
  const warnings: string[] = [];

  return {
    messages,
    warnings,
    info(message) {
      messages.push(message);
    },
    progress(message) {
      messages.push(message);
    },
    warn(message) {
      warnings.push(message);
    }
  };
};

const shouldUseColor = (): boolean => {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
};

const shouldRewriteProgress = (): boolean => {
  return Boolean(process.stdout.isTTY);
};

const countRenderedRows = (value: string, columns: number | undefined): number => {
  const terminalColumns = columns && columns > 0 ? columns : 80;
  const visibleLines = stripAnsiCodes(value).split('\n');

  return visibleLines.reduce((rows, line) => {
    return rows + Math.max(1, Math.ceil(line.length / terminalColumns));
  }, 0);
};

const stripAnsiCodes = (value: string): string => {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
};

const formatInfoMessage = (message: string, colorsEnabled: boolean): string => {
  const styled = createStyle(colorsEnabled);

  if (message === 'Starting source inventory checks.') {
    return `\n${styled.bold(styled.cyan('Checking sources'))}`;
  }

  if (message === 'Ingestion refresh complete.') {
    return styled.green('Ingestion refresh complete.');
  }

  if (message === 'Refreshing retrieval indexes.') {
    return `\n${styled.bold(styled.cyan('Refreshing retrieval indexes'))}`;
  }

  if (message === 'Retrieval indexes ready.') {
    return styled.green('Retrieval indexes ready.');
  }

  if (message.startsWith('Startup refresh complete')) {
    return `\n${styled.bold(styled.green(message))}`;
  }

  if (message.startsWith('Retrieval debug refresh complete.')) {
    return `\n${styled.bold(styled.green(message))}`;
  }

  if (message.startsWith('Results for ')) {
    return styled.bold(message);
  }

  if (/unchanged|skipping|ingestion skipped|fetching|parsing|reused=/.test(message)) {
    return styled.dim(message);
  }

  if (/indexed|ingested|ready|complete/.test(message)) {
    return styled.green(message);
  }

  return message;
};

const formatWarningMessage = (message: string, colorsEnabled: boolean): string => {
  return createStyle(colorsEnabled).yellow(message);
};

const createStyle = (enabled: boolean) => {
  const wrap = (open: string, close: string, value: string): string => {
    return enabled ? `${open}${value}${close}` : value;
  };

  return {
    bold(value: string) {
      return wrap('\u001b[1m', '\u001b[22m', value);
    },
    cyan(value: string) {
      return wrap('\u001b[36m', '\u001b[39m', value);
    },
    dim(value: string) {
      return wrap('\u001b[2m', '\u001b[22m', value);
    },
    green(value: string) {
      return wrap('\u001b[32m', '\u001b[39m', value);
    },
    yellow(value: string) {
      return wrap('\u001b[33m', '\u001b[39m', value);
    }
  };
};
