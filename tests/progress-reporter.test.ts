import { afterEach, describe, expect, it, vi } from "vitest";

import { createConsoleProgressReporter } from "../src/progress/reporter.js";

describe("console progress reporter", () => {
  const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

  afterEach(() => {
    vi.restoreAllMocks();

    for (const [property, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(process.stdout, property, descriptor);
      } else {
        Reflect.deleteProperty(process.stdout, property);
      }
    }

    originalDescriptors.clear();
  });

  it("clears every wrapped terminal row before rewriting progress", () => {
    const operations = stubTtyStdout(20);
    const reporter = createConsoleProgressReporter();

    reporter.progress?.("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    reporter.progress?.("next");

    expect(operations).toEqual([
      "write:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "cursorTo:0",
      "clearLine:0",
      "moveCursor:0,-1",
      "clearLine:0",
      "moveCursor:0,-1",
      "clearLine:0",
      "cursorTo:0",
      "write:next"
    ]);
  });

  it("keeps single-row progress rewrites on one terminal row", () => {
    const operations = stubTtyStdout(80);
    const reporter = createConsoleProgressReporter();

    reporter.progress?.("short");
    reporter.progress?.("next");

    expect(operations).toEqual([
      "write:short",
      "cursorTo:0",
      "clearLine:0",
      "cursorTo:0",
      "write:next"
    ]);
  });

  it("clears active wrapped progress before normal log output", () => {
    const operations = stubTtyStdout(10);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const reporter = createConsoleProgressReporter();

    reporter.progress?.("xxxxxxxxxxxxxxxxxxxxx");
    reporter.info("Retrieval indexes ready.");

    expect(operations).toEqual([
      "write:xxxxxxxxxxxxxxxxxxxxx",
      "cursorTo:0",
      "clearLine:0",
      "moveCursor:0,-1",
      "clearLine:0",
      "moveCursor:0,-1",
      "clearLine:0",
      "cursorTo:0"
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Retrieval indexes ready."));
  });

  const stubTtyStdout = (columns: number): string[] => {
    const operations: string[] = [];

    setStdoutProperty("isTTY", true);
    setStdoutProperty("columns", columns);
    setStdoutProperty("clearLine", vi.fn((direction: number) => operations.push(`clearLine:${direction}`)));
    setStdoutProperty(
      "cursorTo",
      vi.fn((x: number) => {
        operations.push(`cursorTo:${x}`);
        return true;
      })
    );
    setStdoutProperty(
      "moveCursor",
      vi.fn((dx: number, dy: number) => {
        operations.push(`moveCursor:${dx},${dy}`);
        return true;
      })
    );

    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      operations.push(`write:${chunk.toString()}`);
      return true;
    }) as typeof process.stdout.write);

    return operations;
  };

  const setStdoutProperty = (property: PropertyKey, value: unknown): void => {
    if (!originalDescriptors.has(property)) {
      originalDescriptors.set(property, Object.getOwnPropertyDescriptor(process.stdout, property));
    }

    Object.defineProperty(process.stdout, property, {
      configurable: true,
      value,
      writable: true
    });
  };
});
