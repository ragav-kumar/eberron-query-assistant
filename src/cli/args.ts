import { parseArgs } from "node:util";

import type { RuntimeOptions } from "../types.js";

export const parseRuntimeOptions = (args: string[] = process.argv.slice(2)): RuntimeOptions => {
  const parsed = parseArgs({
    args,
    options: {
      "force-reingest": {
        type: "boolean",
        default: false
      },
      "retrieval-query": {
        type: "string"
      }
    },
    strict: true,
    allowPositionals: false
  });

  return {
    forceReingest: parsed.values["force-reingest"] ?? false,
    retrievalQuery: normalizeOptionalString(parsed.values["retrieval-query"])
  };
};

const normalizeOptionalString = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.replaceAll("^", "").trim();
  return normalized.length > 0 ? normalized : null;
};
