import { createInterface } from "node:readline/promises";

import type { Readable, Writable } from "node:stream";

import type { ProgressReporter } from "../progress/reporter.js";

export interface PromptShell {
  start(): Promise<void>;
}

export interface PromptShellOptions {
  input?: Readable;
  output?: Writable;
  reporter: ProgressReporter;
}

export class StubPromptShell implements PromptShell {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly reporter: ProgressReporter;

  constructor(options: PromptShellOptions) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.reporter = options.reporter;
  }

  async start(): Promise<void> {
    const rl = createInterface({
      input: this.input,
      output: this.output,
      terminal: false
    });

    try {
      this.reporter.info("Eberron Query Assistant prompt ready. Type exit or quit to end.");

      while (true) {
        const answer = await rl.question("> ");
        const command = answer.trim().toLowerCase();

        if (command === "exit" || command === "quit") {
          break;
        }

        if (command.length > 0) {
          this.reporter.info("Assistant runtime is not implemented yet; this is the Phase 1 prompt shell.");
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    } finally {
      rl.close();
      this.reporter.info("Prompt closed.");
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
