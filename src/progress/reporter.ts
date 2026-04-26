export interface ProgressReporter {
  info(message: string): void;
  warn(message: string): void;
}

export interface MemoryProgressReporter extends ProgressReporter {
  readonly messages: string[];
  readonly warnings: string[];
}

export const createConsoleProgressReporter = (): ProgressReporter => {
  const colorsEnabled = shouldUseColor();

  return {
    info(message) {
      console.log(formatInfoMessage(message, colorsEnabled));
    },

    warn(message) {
      console.warn(formatWarningMessage(message, colorsEnabled));
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
    warn(message) {
      warnings.push(message);
    }
  };
};

const shouldUseColor = (): boolean => {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
};

const formatInfoMessage = (message: string, colorsEnabled: boolean): string => {
  const styled = createStyle(colorsEnabled);

  if (message === "Starting source inventory checks.") {
    return `\n${styled.bold(styled.cyan("Checking sources"))}`;
  }

  if (message === "Ingestion refresh complete.") {
    return styled.green("Ingestion refresh complete.");
  }

  if (message === "Refreshing retrieval indexes.") {
    return `\n${styled.bold(styled.cyan("Refreshing retrieval indexes"))}`;
  }

  if (message === "Retrieval indexes ready.") {
    return styled.green("Retrieval indexes ready.");
  }

  if (message.startsWith("Startup refresh complete")) {
    return `\n${styled.bold(styled.green(message))}`;
  }

  if (message.startsWith("Retrieval debug refresh complete.")) {
    return `\n${styled.bold(styled.green(message))}`;
  }

  if (message.startsWith("Results for ")) {
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
      return wrap("\u001b[1m", "\u001b[22m", value);
    },
    cyan(value: string) {
      return wrap("\u001b[36m", "\u001b[39m", value);
    },
    dim(value: string) {
      return wrap("\u001b[2m", "\u001b[22m", value);
    },
    green(value: string) {
      return wrap("\u001b[32m", "\u001b[39m", value);
    },
    yellow(value: string) {
      return wrap("\u001b[33m", "\u001b[39m", value);
    }
  };
};
