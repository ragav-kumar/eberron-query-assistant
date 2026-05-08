import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasErrorCode } from "../../errors.js";
import type { RuntimeConfig } from "../../types.js";

export interface ArticleRawCache {
  read(config: RuntimeConfig, url: string): Promise<string | null>;
  write(config: RuntimeConfig, url: string, html: string): Promise<void>;
}

export const createFilesystemArticleRawCache = (): ArticleRawCache => {
  return {
    async read(config, url) {
      try {
        return await readFile(getArticleCachePath(config, url), "utf8");
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
          return null;
        }
        throw error;
      }
    },
    async write(config, url, html) {
      const cachePath = getArticleCachePath(config, url);
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, html, "utf8");
    }
  };
};

const getArticleCachePath = (config: RuntimeConfig, url: string): string => {
  return path.join(config.cacheDir, "keith-baker", `${hashUrl(url)}.html`);
};

const hashUrl = (url: string): string => {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
};
