import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

describe("package scripts", () => {
  it("exposes the GUI app script and removes CLI workflows", () => {
    const metadata = packageJson as {
      bin?: unknown;
      scripts: Record<string, string | undefined>;
    };

    expect(metadata.bin).toBeUndefined();
    expect(metadata.scripts.start).toBe("vite --host 127.0.0.1");
    expect(metadata.scripts.prestart).toBe("tsc --noEmit");
    expect(metadata.scripts.build).toBeUndefined();
    expect(metadata.scripts.reingest).toBeUndefined();
    expect(metadata.scripts["debug:retrieval"]).toBeUndefined();
  });

  it("keeps local session transcripts gitignored", () => {
    expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain("logs/");
  });
});
