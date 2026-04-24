import { describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { MemoryProgressReporter } from "../src/progress/reporter.js";
import { runRuntime } from "../src/runtime/index.js";
import { runStartupRefresh } from "../src/runtime/refresh.js";
import { PlaceholderSourceDiscoveryService } from "../src/source-discovery/index.js";
import { PlaceholderStateStore } from "../src/state/index.js";

describe("startup refresh skeleton", () => {
  it("emits readable placeholder progress", async () => {
    const reporter = new MemoryProgressReporter();

    await runStartupRefresh(loadDefaultConfig("repo"), { forceReingest: true }, {
      discovery: new PlaceholderSourceDiscoveryService(),
      reporter,
      stateStore: new PlaceholderStateStore()
    });

    expect(reporter.messages).toContain("Starting source inventory checks.");
    expect(reporter.messages).toContain(
      "Force re-ingest requested; placeholder refresh will treat all sources as scheduled."
    );
    expect(reporter.messages).toContain("Placeholder retrieval refresh complete.");
    expect(reporter.messages).toContain("Startup refresh complete; entering assistant prompt.");
    expect(reporter.messages.some((message) => message.startsWith("foundry: placeholder inventory complete"))).toBe(
      true
    );
  });

  it("reaches the prompt boundary after startup", async () => {
    const prompt = {
      start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    const summary = await runRuntime(
      { forceReingest: false },
      {
        config: loadDefaultConfig("repo"),
        prompt,
        reporter: new MemoryProgressReporter()
      }
    );

    expect(prompt.start).toHaveBeenCalledOnce();
    expect(summary.degraded).toBe(false);
    expect(summary.inventories).toHaveLength(3);
  });
});
