import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import type { ArticleStateRecord } from "../state/index.js";
import type { CorpusChunk, CorpusSource } from "../types.js";
import { chunkText, normalizeText } from "./chunking.js";

export const KEITH_BAKER_INDEX_URL = "https://keith-baker.com/eberron-index/";

export interface ArticleFetcher {
  fetchText(url: string): Promise<string>;
}

const FETCH_TIMEOUT_MS = 30_000;
const PERMANENTLY_INACCESSIBLE_STATUSES = new Set([403, 404]);

export interface HttpFetchFailedError {
  kind: "http-fetch-failed";
  message: string;
  name: string;
  status: number;
  statusText: string;
  url: string;
}

export const createFetchArticleFetcher = (): ArticleFetcher => {
  return {
    async fetchText(url) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, { signal: abortController.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw {
          kind: "http-fetch-failed",
          message: `GET ${url} failed with ${response.status} ${response.statusText}`,
          name: "http-fetch-failed",
          status: response.status,
          statusText: response.statusText,
          url
        } satisfies HttpFetchFailedError;
      }
      return response.text();
    }
  };
};

export const isPermanentlyInaccessibleArticleFetch = (value: unknown): value is HttpFetchFailedError => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HttpFetchFailedError>;
  return (
    candidate.kind === "http-fetch-failed" &&
    typeof candidate.status === "number" &&
    PERMANENTLY_INACCESSIBLE_STATUSES.has(candidate.status)
  );
};

export interface ArticleDiscoveryResult {
  articles: ArticleStateRecord[];
  discoveredUrls: string[];
}

export const discoverArticleLinks = (
  indexHtml: string,
  previousArticles: ArticleStateRecord[],
  now: string
): ArticleDiscoveryResult => {
  const $ = cheerio.load(indexHtml);
  const content = $("main, article, .entry-content, #content").first();
  const root = content.length > 0 ? content : $("body");
  const previous = new Map(previousArticles.map((article) => [article.canonicalUrl, article]));
  const discoveredUrls = [
    ...new Set(
      root
        .find("a[href]")
        .toArray()
        .map((element) => canonicalArticleUrl($(element).attr("href")))
        .filter((url): url is string => url !== null)
    )
  ].sort((a, b) => a.localeCompare(b));

  const articles = new Map(previous);
  for (const url of discoveredUrls) {
    if (!articles.has(url)) {
      articles.set(url, {
        canonicalUrl: url,
        title: null,
        firstSeenAt: now,
        lastIngestedAt: null,
        scrapeStatus: "pending"
      });
    }
  }

  return {
    articles: [...articles.values()].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)),
    discoveredUrls
  };
};

export const normalizeArticle = (
  url: string,
  html: string,
  previous: ArticleStateRecord | null,
  now: string
): {
  article: ArticleStateRecord;
  source: CorpusSource;
  chunks: CorpusChunk[];
} => {
  const $ = cheerio.load(html);
  const articleElement = $("article, main, .entry-content, #content").first();
  const root = articleElement.length > 0 ? articleElement : $("body");
  root.find("script, style, nav, footer, form, noscript").remove();

  const title =
    normalizeText($(".entry-title").first().text()) ||
    normalizeText($("article h1, main h1").first().text()) ||
    normalizeText($('meta[property="og:title"]').attr("content") ?? "") ||
    normalizeText($("h1").first().text()) ||
    normalizeTitleElement($("title").first().text()) ||
    previous?.title ||
    url;
  const headings = root
    .find("h2, h3")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .filter((heading) => heading.length > 0);
  const bodyText = normalizeText(
    root
      .find("p, li, h2, h3, blockquote")
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .filter((text) => text.length > 0)
      .join("\n\n")
  );

  const sourceKey = url;
  const sourceId = `article:${hashText(sourceKey)}`;
  const contentHash = hashText(bodyText);
  const source: CorpusSource = {
    sourceId,
    sourceType: "article",
    sourceKey,
    title,
    status: "succeeded",
    metadata: {
      sourceType: "article",
      url,
      title,
      headings,
      contentHash
    }
  };

  const chunks = chunkText(bodyText).map((chunk, chunkIndex): CorpusChunk => ({
    chunkId: `${sourceId}:chunk:${chunkIndex}`,
    sourceId,
    chunkIndex,
    text: chunk.text,
    citation: {
      sourceType: "article",
      label: title,
      locator: null,
      url
    },
    metadata: {
      sourceType: "article",
      url,
      title,
      headings,
      startParagraph: chunk.startParagraph,
      endParagraph: chunk.endParagraph
    }
  }));

  return {
    article: {
      canonicalUrl: url,
      title,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastIngestedAt: now,
      scrapeStatus: "succeeded"
    },
    source,
    chunks
  };
};

const canonicalArticleUrl = (href: string | undefined): string | null => {
  if (!href) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, KEITH_BAKER_INDEX_URL);
  } catch {
    return null;
  }

  if (url.hostname !== "keith-baker.com") {
    return null;
  }

  url.hash = "";
  url.search = "";
  const value = url.toString();
  if (value === KEITH_BAKER_INDEX_URL || !value.startsWith("https://keith-baker.com/")) {
    return null;
  }
  return value;
};

const normalizeTitleElement = (title: string): string => {
  return normalizeText(title)
    .replace(/\s*[-|]\s*Keith Baker'?s Blog$/i, "")
    .replace(/\s*[-|]\s*Keith Baker.*$/i, "")
    .trim();
};

const hashText = (text: string): string => {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
};
