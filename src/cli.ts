#!/usr/bin/env node
import { parseRuntimeOptions } from "./cli/args.js";
import { runRuntime } from "./runtime/index.js";

try {
  const options = parseRuntimeOptions();
  await runRuntime(options);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
}
