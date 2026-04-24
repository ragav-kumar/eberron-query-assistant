import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";

describe("loadDefaultConfig", () => {
  it("resolves documented repo-local default paths", () => {
    const repoRoot = path.resolve("example-repo");

    expect(loadDefaultConfig(repoRoot)).toEqual({
      repoRoot,
      foundryExportDir: path.join(repoRoot, "foundry-export"),
      pdfDir: path.join(repoRoot, "pdf"),
      runtimeDir: path.join(repoRoot, ".eberron-query-assistant"),
      stateDir: path.join(repoRoot, ".eberron-query-assistant", "state"),
      cacheDir: path.join(repoRoot, ".eberron-query-assistant", "cache"),
      retrievalDir: path.join(repoRoot, ".eberron-query-assistant", "retrieval")
    });
  });
});
