import packageJson from "../package.json" with { type: "json" };
import { getAppVersion } from "../src/app-version.js";

import { describe, expect, it } from "vitest";

describe("app version", () => {
  it("is read from package metadata", () => {
    expect(getAppVersion()).toBe(packageJson.version);
  });
});
