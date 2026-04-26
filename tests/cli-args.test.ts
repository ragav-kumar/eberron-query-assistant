import { describe, expect, it } from "vitest";

import { parseRuntimeOptions } from "../src/cli/args.js";

describe("parseRuntimeOptions", () => {
  it("defaults forceReingest to false", () => {
    expect(parseRuntimeOptions([])).toEqual({ forceReingest: false, retrievalQuery: null });
  });

  it("recognizes --force-reingest", () => {
    expect(parseRuntimeOptions(["--force-reingest"])).toEqual({ forceReingest: true, retrievalQuery: null });
  });

  it("recognizes --retrieval-query", () => {
    expect(parseRuntimeOptions(["--retrieval-query", "aerenal deathless"])).toEqual({
      forceReingest: false,
      retrievalQuery: "aerenal deathless"
    });
  });

  it("normalizes PowerShell caret-escaped retrieval query quotes", () => {
    expect(parseRuntimeOptions(["--retrieval-query", "^Becoming^ God^"])).toEqual({
      forceReingest: false,
      retrievalQuery: "Becoming God"
    });
  });
});
