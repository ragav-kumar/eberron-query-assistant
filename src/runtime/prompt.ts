import { createInterface } from "node:readline/promises";

import type { Readable, Writable } from "node:stream";

import { hasErrorName } from "../errors.js";
import type { ProgressReporter } from "../progress/reporter.js";

export interface PromptShell {
  start(): Promise<void>;
}

export interface PromptShellOptions {
  input?: Readable;
  output?: Writable;
  reporter: ProgressReporter;
}

export const createStubPromptShell = (options: PromptShellOptions): PromptShell => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const reporter = options.reporter;

  return {
    async start() {
      const rl = createInterface({
        input,
        output,
        terminal: false
      });

      try {
        reporter.info("Eberron Query Assistant prompt ready. Type exit or quit to end.");

        while (true) {
          const answer = await rl.question("> ");
          const command = answer.trim().toLowerCase();

          if (command === "exit" || command === "quit") {
            break;
          }

          if (command.length > 0) {
            reporter.info("Assistant runtime is not implemented yet; this is the Phase 1 prompt shell.");
          }
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        rl.close();
        reporter.info("Prompt closed.");
      }
    }
  };
};

const isAbortError = (error: unknown): boolean => {
  return hasErrorName(error, "AbortError");
};
