import { describe, expect, it } from "vitest";

import { parseRuntimeOptions } from "../src/cli/args.js";

describe("parseRuntimeOptions", () => {
  it("defaults forceReingest to false", () => {
    expect(parseRuntimeOptions([])).toEqual({ forceReingest: false });
  });

  it("recognizes --force-reingest", () => {
    expect(parseRuntimeOptions(["--force-reingest"])).toEqual({ forceReingest: true });
  });
});
