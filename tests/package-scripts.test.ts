import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

describe("package scripts", () => {
  it("exposes the GUI app script and removes CLI workflows", () => {
    const metadata = packageJson as {
      bin?: unknown;
      scripts: Record<string, string | undefined>;
    };

    expect(metadata.bin).toBeUndefined();
    expect(metadata.scripts.start).toBe("vite");
    expect(metadata.scripts.prestart).toBe("tsc --noEmit");
    expect(metadata.scripts.verify).toBe("npm run lint && npm run prestart && npm run test");
    expect(metadata.scripts.build).toBeUndefined();
    expect(metadata.scripts.reingest).toBeUndefined();
    expect(metadata.scripts["debug:retrieval"]).toBeUndefined();
  });

  it("keeps local session transcripts gitignored", () => {
    expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain("logs/");
  });

  it("keeps runtime artifact directories out of Vite file watching", () => {
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(viteConfig).toContain("**/.eberron-query-assistant/**");
    expect(viteConfig).toContain("**/logs/**");
    expect(viteConfig).toContain("**/foundry-export/**");
    expect(viteConfig).toContain("**/pdf/**");
  });

  it("does not retain terminal CLI runtime sources", () => {
    const sourceText = readProjectFiles(["src", "tests"])
      .filter(({ filePath }) => !filePath.endsWith(path.join("tests", "package-scripts.test.ts")))
      .map(({ text }) => text)
      .join("\n");

    expect(sourceText).not.toContain("node:readline/promises");
    expect(sourceText).not.toContain("createAssistantPromptShell");
    expect(sourceText).not.toContain("PromptShell");
    expect(sourceText).not.toContain("runRuntime");
    expect(sourceText).not.toContain("retrievalQuery");
  });
});

const readProjectFiles = (roots: string[]): Array<{ filePath: string; text: string }> => {
  const files: Array<{ filePath: string; text: string }> = [];
  const visit = (entryPath: string): void => {
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      for (const child of readdirSync(entryPath)) {
        visit(path.join(entryPath, child));
      }
      return;
    }
    if (/\.(?:ts|tsx)$/.test(entryPath)) {
      files.push({
        filePath: entryPath,
        text: readFileSync(entryPath, "utf8")
      });
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return files;
};
