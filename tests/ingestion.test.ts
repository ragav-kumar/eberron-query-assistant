import Database from "better-sqlite3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from "../src/config/index.js";
import { createTaggedError } from "../src/errors.js";
import {
  createFilesystemIngestionService,
  createSqliteCorpusStore,
  discoverArticleLinks,
  getCorpusDatabasePath,
  normalizeArticle,
  type ArticleFetcher,
  type CorpusStore,
  type PdfParser
} from "../src/ingestion/index.js";
import { chunkText } from "../src/ingestion/chunking.js";
import type { SourceDiscoverySummary } from "../src/source-discovery/index.js";
import { createDefaultRuntimeState, type RuntimeState } from "../src/state/state-store.js";

const TEST_ROOT = path.resolve(".test-tmp", "ingestion");
const NOW = new Date("2026-04-24T12:00:00.000Z");
const stores: CorpusStore[] = [];

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
    const result = await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["foundry"]));

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

  it("preserves Foundry export metadata needed for party context", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(
      path.join(config.foundryExportDir, "records.ndjson"),
      `${JSON.stringify({
        recordId: "world.journalentrypage.session.note",
        sourceType: "JournalEntryPage",
        sourceScope: "world",
        sourceId: "note",
        sourceUuid: "JournalEntry.session.JournalEntryPage.note",
        parentId: "session",
        parentUuid: "JournalEntry.session",
        packId: null,
        title: "2026-04-25",
        body: "The party reached Vathirond.",
        metadata: {
          provenance: {
            collection: "journal",
            path: ["Session Notes", "2026-04-25"]
          },
          classification: {
            documentType: "JournalEntryPage",
            tags: ["page-type:text"]
          },
          citation: {
            anchor: "Session Notes > 2026-04-25"
          }
        },
        timestamps: {
          createdTime: 1770000000000,
          modifiedTime: 1771000000000
        }
      })}\n`,
      "utf8"
    );

    const service = createService();
    const state = createDefaultRuntimeState();
    await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["foundry"]));

    const rows = readRows(config, "SELECT source_key, title, metadata_json FROM sources");
    expect(rows[0]).toMatchObject({
      source_key: "world.journalentrypage.session.note",
      title: "2026-04-25"
    });
    expect(JSON.parse(String(rows[0]?.metadata_json))).toMatchObject({
      entityKind: "JournalEntryPage",
      sourceScope: "world",
      sourceUuid: "JournalEntry.session.JournalEntryPage.note",
      parentUuid: "JournalEntry.session",
      provenancePath: ["Session Notes", "2026-04-25"],
      classificationTags: ["page-type:text"],
      citationAnchor: "Session Notes > 2026-04-25",
      modifiedTime: 1771000000000
    });
  });

  it("does not commit foundry state when NDJSON parsing fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(path.join(config.foundryExportDir, "records.ndjson"), "{not-json}\n", "utf8");

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["foundry"]));

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

    await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["pdf"]));

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
    const fetcher = createMapArticleFetcher(
      new Map([
        [
          "https://keith-baker.com/eberron-index/",
          '<main><a href="/new-article/">New</a><a href="https://example.com/out">Out</a></main>'
        ],
        [
          "https://keith-baker.com/new-article/",
          '<article><h1>New Article</h1><p>The Trust watches Zilargo carefully.</p><a href="/do-not-recurse/">Nested</a><h2>Secrets</h2><p>Gnomes keep notes.</p></article>'
        ]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    const result = await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["article"]));

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

  it("uses article-specific title metadata instead of the generic blog title", () => {
    const normalized = normalizeArticle(
      "https://keith-baker.com/example/",
      '<html><head><title>Example Article - Keith Baker&apos;s Blog</title><meta property="og:title" content="Example Article"></head><body><article><p>Dragonmarks matter.</p></article></body></html>',
      null,
      NOW.toISOString()
    );

    expect(normalized.source.title).toBe("Example Article");
    expect(normalized.chunks[0]?.citation.label).toBe("Example Article");
  });

  it("does not commit PDF inventory state when an added PDF fails to parse", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.pdfDir, { recursive: true });
    await writeFile(path.join(config.pdfDir, "broken.pdf"), "", "utf8");

    const seedStore = createSqliteCorpusStore();
    stores.push(seedStore);
    await seedStore.initialize(config);
    await seedStore.replaceSource(config, {
      sourceId: "article:https://keith-baker.com/existing/",
      sourceType: "article",
      sourceKey: "https://keith-baker.com/existing/",
      title: "Existing Article",
      metadata: {},
      status: "succeeded"
    }, [
      {
        chunkId: "article:https://keith-baker.com/existing/:0",
        sourceId: "article:https://keith-baker.com/existing/",
        chunkIndex: 0,
        text: "Existing article text.",
        citation: {
          sourceType: "article",
          label: "Existing Article",
          locator: null,
          url: "https://keith-baker.com/existing/"
        },
        metadata: {}
      }
    ]);

    const state = createDefaultRuntimeState();
    state.pdf.knownFilenames = [];
    const service = createService({
      pdfParser: {
        parse: () => Promise.reject(new Error("simulated parse failure"))
      }
    });
    const discovery = scheduledDiscovery(state, ["pdf"]);
    discovery.inventories = discovery.inventories.map((inventory) =>
      inventory.sourceType === "pdf"
        ? {
            ...inventory,
            removed: 0,
            details: ["added:broken.pdf"]
          }
        : inventory
    );
    discovery.nextState.pdf.knownFilenames = ["broken.pdf"];
    const result = await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, discovery);

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "pdf")).toMatchObject({
      failed: 1,
      status: "failed"
    });
    expect(result.nextState.pdf.knownFilenames).toEqual([]);
    expect(readRows(config, "SELECT source_type, source_key FROM sources")).toEqual([
      {
        source_type: "article",
        source_key: "https://keith-baker.com/existing/"
      }
    ]);
  });

  it("does not advance the article scrape cadence when an article page fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    state.article.lastSuccessfulIndexScrapeAt = "2026-04-17T12:00:00.000Z";
    const fetcher = createMapArticleFetcher(
      new Map([
        [
          "https://keith-baker.com/eberron-index/",
          '<main><a href="/new-article/">New</a></main>'
        ]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    const result = await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, ["article"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "article")).toMatchObject({
      failed: 1,
      status: "failed"
    });
    expect(result.nextState.article.lastSuccessfulIndexScrapeAt).toBe("2026-04-17T12:00:00.000Z");
    expect(result.nextState.article.knownArticles).toMatchObject([
      {
        canonicalUrl: "https://keith-baker.com/new-article/",
        scrapeStatus: "failed"
      }
    ]);
  });

  it("marks 403 and 404 Keith Baker articles inaccessible and excludes them from future retries", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    state.article.knownArticles = [
      {
        canonicalUrl: "https://keith-baker.com/forbidden/",
        title: null,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: null,
        scrapeStatus: "pending"
      },
      {
        canonicalUrl: "https://keith-baker.com/gone/",
        title: null,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: null,
        scrapeStatus: "pending"
      },
      {
        canonicalUrl: "https://keith-baker.com/already-inaccessible/",
        title: null,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: null,
        scrapeStatus: "inaccessible"
      }
    ];
    const fetcher = createMapArticleFetcher(
      new Map([
        [
          "https://keith-baker.com/eberron-index/",
          '<main><a href="/forbidden/">Forbidden</a><a href="/gone/">Gone</a><a href="/already-inaccessible/">Already Inaccessible</a></main>'
        ]
      ]),
      new Map([
        ["https://keith-baker.com/forbidden/", 403],
        ["https://keith-baker.com/gone/", 404]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    const result = await service.ingest(config, { forceReingest: true, retrievalQuery: null }, state, scheduledDiscovery(state, ["article"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "article")).toMatchObject({
      failed: 0,
      status: "succeeded"
    });
    expect(result.nextState.article.knownArticles).toMatchObject([
      {
        canonicalUrl: "https://keith-baker.com/already-inaccessible/",
        scrapeStatus: "inaccessible"
      },
      {
        canonicalUrl: "https://keith-baker.com/forbidden/",
        scrapeStatus: "inaccessible"
      },
      {
        canonicalUrl: "https://keith-baker.com/gone/",
        scrapeStatus: "inaccessible"
      }
    ]);
  });

  it("splits oversized single paragraphs into bounded chunks", () => {
    const chunks = chunkText("word ".repeat(1_000), 1_600);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 1_600)).toBe(true);
    expect(chunks.every((chunk) => chunk.startParagraph === 0 && chunk.endParagraph === 0)).toBe(true);
  });

  it("clears the corpus store only for force re-ingest", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    const corpusStoreFixture = createMockCorpusStore();
    const service = createFilesystemIngestionService({
      articleFetcher: createMapArticleFetcher(new Map()),
      corpusStore: corpusStoreFixture.corpusStore,
      now: () => NOW,
      pdfParser: {
        parse: () => Promise.resolve({ pageCount: 0, fingerprint: null, title: null, pages: [] })
      },
      reporter: {
        info: () => undefined,
        warn: () => undefined
      }
    });

    await service.ingest(config, { forceReingest: false, retrievalQuery: null }, state, scheduledDiscovery(state, []));
    await service.ingest(config, { forceReingest: true, retrievalQuery: null }, state, scheduledDiscovery(state, []));

    expect(corpusStoreFixture.initialize).toHaveBeenNthCalledWith(1, config, { allowIncompatibleReset: false });
    expect(corpusStoreFixture.initialize).toHaveBeenNthCalledWith(2, config, { allowIncompatibleReset: true });
    expect(corpusStoreFixture.clear).toHaveBeenCalledTimes(1);
    expect(corpusStoreFixture.clear).toHaveBeenCalledWith(config);
  });
});

const createService = (options: { articleFetcher?: ArticleFetcher; pdfParser?: PdfParser } = {}) => {
  const corpusStore = createSqliteCorpusStore();
  stores.push(corpusStore);
  const dependencies = {
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
    },
    ...(options.articleFetcher ? { articleFetcher: options.articleFetcher } : {})
  };
  return createFilesystemIngestionService({
    ...dependencies
  });
};

const scheduledDiscovery = (state: RuntimeState, scheduled: Array<"foundry" | "pdf" | "article">): SourceDiscoverySummary => {
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
        message: "foundry",
        details: []
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
        message: "article",
        details: []
      }
    ]
  };
};

const readRows = (config: ReturnType<typeof loadDefaultConfig>, sql: string): Array<Record<string, unknown>> => {
  const database = new Database(getCorpusDatabasePath(config), { readonly: true });
  try {
    return database.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
};

const createMapArticleFetcher = (responses: Map<string, string>, statuses: Map<string, number> = new Map()): ArticleFetcher => {
  return {
    fetchText(url) {
      const status = statuses.get(url);
      if (status) {
        throw {
          kind: "http-fetch-failed",
          message: `GET ${url} failed with ${status} fixture`,
          name: "http-fetch-failed",
          status,
          statusText: "fixture",
          url
        };
      }
      const response = responses.get(url);
      if (!response) {
        throw createTaggedError("missing-article-fixture", `Missing fixture for ${url}`);
      }
      return Promise.resolve(response);
    }
  };
};

const createMockCorpusStore = (): {
  clear: ReturnType<typeof vi.fn<CorpusStore["clear"]>>;
  corpusStore: CorpusStore;
  initialize: ReturnType<typeof vi.fn<CorpusStore["initialize"]>>;
} => {
  const initialize = vi.fn<CorpusStore["initialize"]>().mockResolvedValue(undefined);
  const clear = vi.fn<CorpusStore["clear"]>().mockResolvedValue(undefined);

  return {
    clear,
    corpusStore: {
      initialize,
      clear,
      replaceSource: vi.fn<CorpusStore["replaceSource"]>().mockResolvedValue(undefined),
      replaceSourcesByType: vi.fn<CorpusStore["replaceSourcesByType"]>().mockResolvedValue(undefined),
      removeSource: vi.fn<CorpusStore["removeSource"]>().mockResolvedValue(undefined),
      removeSourcesByType: vi.fn<CorpusStore["removeSourcesByType"]>().mockResolvedValue(undefined),
      countSources: vi.fn<CorpusStore["countSources"]>().mockResolvedValue(1),
      rebuildSearchIndex: vi.fn<CorpusStore["rebuildSearchIndex"]>().mockResolvedValue(undefined),
      close: vi.fn<CorpusStore["close"]>()
    },
    initialize
  };
};
