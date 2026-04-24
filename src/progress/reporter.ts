export interface ProgressReporter {
  info(message: string): void;
  warn(message: string): void;
}

export class ConsoleProgressReporter implements ProgressReporter {
  info(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(message);
  }
}

export class MemoryProgressReporter implements ProgressReporter {
  readonly messages: string[] = [];
  readonly warnings: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }
}
