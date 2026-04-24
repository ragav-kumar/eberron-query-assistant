import Database from "better-sqlite3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import {
  FilesystemIngestionService,
  SqliteCorpusStore,
  discoverArticleLinks,
  getCorpusDatabasePath,
  type ArticleFetcher,
  type PdfParser
} from "../src/ingestion/index.js";
import type { SourceDiscoverySummary } from "../src/source-discovery/index.js";
import { createDefaultRuntimeState, type RuntimeState } from "../src/state/state-store.js";

const TEST_ROOT = path.resolve(".test-tmp", "ingestion");
const NOW = new Date("2026-04-24T12:00:00.000Z");
const stores: SqliteCorpusStore[] = [];

describe("Phase 3 ingestion", () => {
  beforeEach(async () => {
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("ingests foundry NDJSON with citation metadata and commits the export marker", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(
      path.join(config.foundryExportDir, "records.ndjson"),
      `${JSON.stringify({
        id: "actor-1",
        type: "Actor",
        name: "Ashana",
        system: {
          description: {
            value: "A kalashtar emissary from Sharn."
          }
        }
      })}\n`,
      "utf8"
    );

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["foundry"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      status: "succeeded",
      ingested: 1
    });
    expect(result.nextState.foundry.lastSuccessfulExport?.runId).toBe("run-3");

    const rows = readRows(config, "SELECT source_type, source_key, title, metadata_json FROM sources");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source_type: "foundry", source_key: "actor-1", title: "Ashana" });
    expect(JSON.parse(String(rows[0]?.metadata_json))).toMatchObject({
      entityKind: "Actor",
      recordId: "actor-1",
      exportRunId: "run-3"
    });
  });

  it("does not commit foundry state when NDJSON parsing fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(path.join(config.foundryExportDir, "records.ndjson"), "{not-json}\n", "utf8");

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["foundry"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      status: "failed",
      failed: 1
    });
    expect(result.nextState.foundry.lastSuccessfulExport).toBeNull();
    expect(readRows(config, "SELECT * FROM sources")).toHaveLength(0);
  });

  it("ingests added PDFs and removes deleted PDFs using page metadata", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.pdfDir, { recursive: true });
    await writeFile(path.join(config.pdfDir, "new.pdf"), "", "utf8");

    const state = createDefaultRuntimeState();
    state.pdf.knownFilenames = ["removed.pdf"];

    const service = createService({
      pdfParser: {
        parse: () =>
          Promise.resolve({
          pageCount: 1,
          fingerprint: "fingerprint",
          title: "New Book",
          pages: [{ pageNumber: 4, text: "Aerenal has deathless counselors." }]
        })
      }
    });

    await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["pdf"]));

    const chunks = readRows(config, "SELECT text, citation_json, metadata_json FROM chunks");
    expect(chunks).toHaveLength(1);
    expect(JSON.parse(String(chunks[0]?.citation_json))).toMatchObject({
      sourceType: "pdf",
      label: "New Book",
      locator: "page 4"
    });
    expect(JSON.parse(String(chunks[0]?.metadata_json))).toMatchObject({
      filename: "new.pdf",
      pageNumber: 4
    });
  });

  it("discovers article URLs and ingests new articles while retaining scrape state", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    const fetcher = new MapArticleFetcher(
      new Map([
        [
          "https://keith-baker.com/eberron-index/",
          '<main><a href="/new-article/">New</a><a href="https://example.com/out">Out</a></main>'
        ],
        [
          "https://keith-baker.com/new-article/",
          "<article><h1>New Article</h1><p>The Trust watches Zilargo carefully.</p><h2>Secrets</h2><p>Gnomes keep notes.</p></article>"
        ]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["article"]));

    expect(result.nextState.article.lastSuccessfulIndexScrapeAt).toBe(NOW.toISOString());
    expect(result.nextState.article.knownArticles).toMatchObject([
      {
        canonicalUrl: "https://keith-baker.com/new-article/",
        title: "New Article",
        scrapeStatus: "succeeded"
      }
    ]);

    const rows = readRows(config, "SELECT source_type, source_key, title FROM sources");
    expect(rows).toEqual([
      {
        source_type: "article",
        source_key: "https://keith-baker.com/new-article/",
        title: "New Article"
      }
    ]);
  });

  it("dedupes and canonicalizes Keith Baker index links", () => {
    const result = discoverArticleLinks(
      '<main><a href="/a/?x=1#part">A</a><a href="https://keith-baker.com/a/">A2</a></main>',
      [],
      NOW.toISOString()
    );

    expect(result.discoveredUrls).toEqual(["https://keith-baker.com/a/"]);
  });
});

function createService(options: { articleFetcher?: ArticleFetcher; pdfParser?: PdfParser } = {}) {
  const corpusStore = new SqliteCorpusStore();
  stores.push(corpusStore);
  return new FilesystemIngestionService({
    articleFetcher: options.articleFetcher,
    corpusStore,
    now: () => NOW,
    pdfParser: options.pdfParser ?? {
      parse: () =>
        Promise.resolve({
          pageCount: 0,
          fingerprint: null,
          title: null,
          pages: []
        })
    },
    reporter: {
      info: () => undefined,
      warn: () => undefined
    }
  });
}

function scheduledDiscovery(state: RuntimeState, scheduled: Array<"foundry" | "pdf" | "article">): SourceDiscoverySummary {
  const nextState = createDefaultRuntimeState();
  nextState.foundry.lastSuccessfulExport = {
    generatedAt: "2026-04-24T10:00:00.000Z",
    recordCount: 1,
    runId: "run-3"
  };
  nextState.pdf.knownFilenames = ["new.pdf"];
  nextState.article.knownArticles = [...state.article.knownArticles];

  return {
    nextState,
    degraded: false,
    inventories: [
      {
        sourceType: "foundry",
        discovered: 1,
        added: 0,
        updated: 1,
        removed: 0,
        failed: 0,
        status: scheduled.includes("foundry") ? "scheduled" : "skipped",
        message: "foundry"
      },
      {
        sourceType: "pdf",
        discovered: 1,
        added: 1,
        updated: 0,
        removed: 1,
        failed: 0,
        status: scheduled.includes("pdf") ? "scheduled" : "skipped",
        message: "pdf",
        details: ["added:new.pdf", "removed:removed.pdf"]
      },
      {
        sourceType: "article",
        discovered: 0,
        added: 0,
        updated: 1,
        removed: 0,
        failed: 0,
        status: scheduled.includes("article") ? "scheduled" : "skipped",
        message: "article"
      }
    ]
  };
}

function readRows(config: ReturnType<typeof loadDefaultConfig>, sql: string): Array<Record<string, unknown>> {
  const database = new Database(getCorpusDatabasePath(config), { readonly: true });
  try {
    return database.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

class MapArticleFetcher implements ArticleFetcher {
  constructor(private readonly responses: Map<string, string>) {}

  fetchText(url: string): Promise<string> {
    const response = this.responses.get(url);
    if (!response) {
      throw new Error(`Missing fixture for ${url}`);
    }
    return Promise.resolve(response);
  }
}
