import path from "node:path";

import type { RuntimeConfig } from "../types.js";

export function loadDefaultConfig(repoRoot = process.cwd()): RuntimeConfig {
  const runtimeDir = path.join(repoRoot, ".eberron-query-assistant");

  return {
    repoRoot,
    foundryExportDir: path.join(repoRoot, "foundry-export"),
    pdfDir: path.join(repoRoot, "pdf"),
    runtimeDir,
    stateDir: path.join(runtimeDir, "state"),
    cacheDir: path.join(runtimeDir, "cache"),
    retrievalDir: path.join(runtimeDir, "retrieval")
  };
}
