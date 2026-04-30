import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

describe("package scripts", () => {
  it("exposes repo-local scripts for the supported runtime operations", () => {
    expect(packageJson.scripts.start).toBe("npm run build && node dist/cli.js");
    expect(packageJson.scripts.reingest).toBe("npm run build && node dist/cli.js --force-reingest");
    expect(packageJson.scripts["debug:retrieval"]).toBe("npm run build && node dist/cli.js --retrieval-query");
  });

  it("keeps local session transcripts gitignored", () => {
    expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain("logs/");
  });
});
