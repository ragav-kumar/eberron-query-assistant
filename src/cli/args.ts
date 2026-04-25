import { parseArgs } from "node:util";

import type { RuntimeOptions } from "../types.js";

export const parseRuntimeOptions = (args: string[] = process.argv.slice(2)): RuntimeOptions => {
  const parsed = parseArgs({
    args,
    options: {
      "force-reingest": {
        type: "boolean",
        default: false
      }
    },
    strict: true,
    allowPositionals: false
  });

  return {
    forceReingest: parsed.values["force-reingest"] ?? false
  };
};
