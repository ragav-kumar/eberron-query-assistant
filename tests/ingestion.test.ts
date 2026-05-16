import Database from "better-sqlite3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDefaultConfig } from '@/server/v1/config/index.js';
import { createTaggedError } from '@/errors.js';
import {
  createFilesystemIngestionService,
  createFilesystemArticleRawCache,
  createSqliteCorpusStore,
  discoverArticleLinks,
  getCorpusDatabasePath,
  normalizeArticle,
  type ArticleRawCache,
  type ArticleFetcher,
  type CorpusStore,
  type PdfParser
} from '@/server/v1/ingestion/index.js';
import { chunkText } from '@/server/v1/ingestion/chunking.js';
import type { SourceDiscoverySummary } from '@/server/v1/source-discovery/index.js';
import { createDefaultRuntimeState, type RuntimeState, type StateStore } from '@/server/v1/state/state-store.js';

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

  it("applies scheduled Foundry delta upserts", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config, "20260424T100000000Z-foundry-export.ndjson", "run-1", [
      upsertRecord({
        recordId: "actor-1",
        sourceType: "Actor",
        name: "Ashana",
        system: {
          description: {
            value: "A kalashtar emissary from Sharn."
          }
        }
      })
    ]);

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["foundry"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      status: "succeeded",
      ingested: 1,
      failed: 0
    });
    expect(result.nextState.foundry.lastSuccessfulExport).toMatchObject({
      filename: "20260424T100000000Z-foundry-export.ndjson",
      runId: "run-1"
    });
    expect(readRows(config, "SELECT source_type, source_key, title FROM sources")).toEqual([
      {
        source_type: "foundry",
        source_key: "actor-1",
        title: "Ashana"
      }
    ]);
  });

  it("preserves rich Foundry metadata from delta upserts", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config, "20260424T100000000Z-foundry-export.ndjson", "run-1", [
      upsertRecord({
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
      })
    ]);

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["foundry"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      status: "succeeded",
      failed: 0
    });
    const rows = readRows(config, "SELECT source_key, title, metadata_json FROM sources");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_key).toBe("world.journalentrypage.session.note");
    expect(JSON.parse(String(rows[0]?.metadata_json))).toMatchObject({
      citationAnchor: "Session Notes > 2026-04-25",
      classificationTags: ["page-type:text"],
      exportRunId: "run-1",
      provenancePath: ["Session Notes", "2026-04-25"],
      sourceUuid: "JournalEntry.session.JournalEntryPage.note"
    });
  });

  it("does not commit foundry state when delta NDJSON parsing fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(path.join(config.foundryExportDir, "20260424T100000000Z-foundry-export.ndjson"), "{not-json}\n", "utf8");

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

  it("applies mixed Foundry upserts and deletes in operation order", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config, "20260424T100000000Z-foundry-export.ndjson", "run-1", [
      upsertRecord({ recordId: "actor-1", sourceType: "Actor", name: "Old Ashana", body: "Old text." })
    ]);
    await writeDeltaExport(config, "20260424T110000000Z-foundry-export.ndjson", "run-2", [
      deleteRecord("actor-1"),
      upsertRecord({ recordId: "actor-2", sourceType: "Actor", name: "Tarin", body: "A Brelish scout." })
    ], { recordCount: 1 });

    const service = createService();
    const state = createDefaultRuntimeState();
    const result = await service.ingest(
      config,
      { forceReingest: false },
      state,
      scheduledDiscovery(state, ["foundry"], {
        foundryAppliedFilenames: [
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T110000000Z-foundry-export.ndjson"
        ],
        foundryLastSuccessfulExport: createFoundryMarker("20260424T110000000Z-foundry-export.ndjson"),
        foundryScheduledFilenames: [
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T110000000Z-foundry-export.ndjson"
        ]
      })
    );

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      ingested: 2,
      removed: 1,
      status: "succeeded"
    });
    expect(readRows(config, "SELECT source_key, title FROM sources WHERE source_type = 'foundry'")).toEqual([
      {
        source_key: "actor-2",
        title: "Tarin"
      }
    ]);
  });

  it("rejects invalid Foundry delta operation envelopes and count mismatches", async () => {
    const cases: Array<{ filename: string; lines: string[] }> = [
      {
        filename: "20260424T100000000Z-foundry-export.ndjson",
        lines: ["{"]
      },
      {
        filename: "20260424T110000000Z-foundry-export.ndjson",
        lines: [JSON.stringify({ kind: "upsert", manifest: validManifest("run-1", 1, 0) })]
      },
      {
        filename: "20260424T120000000Z-foundry-export.ndjson",
        lines: [
          JSON.stringify({ kind: "manifest", manifest: { ...validManifest("run-1", 1, 0), schemaVersion: "1.0.0" } })
        ]
      },
      {
        filename: "20260424T130000000Z-foundry-export.ndjson",
        lines: [
          JSON.stringify({ kind: "manifest", manifest: validManifest("run-1", 1, 0) }),
          JSON.stringify({ kind: "delete", record: {} })
        ]
      },
      {
        filename: "20260424T140000000Z-foundry-export.ndjson",
        lines: [
          JSON.stringify({ kind: "manifest", manifest: validManifest("run-1", 2, 0) }),
          JSON.stringify(upsertRecord({ recordId: "actor-1", name: "Ashana" }))
        ]
      }
    ];

    for (const testCase of cases) {
      for (const store of stores.splice(0)) {
        store.close();
      }
      await rm(TEST_ROOT, { force: true, recursive: true });
      const config = loadDefaultConfig(TEST_ROOT);
      await mkdir(config.foundryExportDir, { recursive: true });
      await writeFile(path.join(config.foundryExportDir, testCase.filename), `${testCase.lines.join("\n")}\n`, "utf8");

      const state = createDefaultRuntimeState();
      const result = await createService().ingest(
        config,
        { forceReingest: false },
        state,
        scheduledDiscovery(state, ["foundry"], {
          foundryAppliedFilenames: [testCase.filename],
          foundryLastSuccessfulExport: createFoundryMarker(testCase.filename),
          foundryScheduledFilenames: [testCase.filename]
        })
      );

      expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
        failed: 1,
        status: "failed"
      });
      expect(result.nextState.foundry.appliedExportFilenames).toEqual([]);
    }
  });

  it("checkpoints successful Foundry files before a later file fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    await writeDeltaExport(config, "20260424T100000000Z-foundry-export.ndjson", "run-1", [
      upsertRecord({ recordId: "actor-1", sourceType: "Actor", name: "Ashana", body: "First file." })
    ]);
    await mkdir(config.foundryExportDir, { recursive: true });
    await writeFile(
      path.join(config.foundryExportDir, "20260424T110000000Z-foundry-export.ndjson"),
      `${JSON.stringify({ kind: "manifest", manifest: validManifest("run-2", 1, 0) })}\n{bad-json}\n`,
      "utf8"
    );
    const savedStates: RuntimeState[] = [];
    const stateStore: StateStore = {
      load: () => Promise.resolve({ state: createDefaultRuntimeState() }),
      save: (_config, savedState) => {
        savedStates.push(cloneRuntimeState(savedState));
        return Promise.resolve();
      }
    };

    const state = createDefaultRuntimeState();
    const result = await createService({ stateStore }).ingest(
      config,
      { forceReingest: false },
      state,
      scheduledDiscovery(state, ["foundry"], {
        foundryAppliedFilenames: [
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T110000000Z-foundry-export.ndjson"
        ],
        foundryLastSuccessfulExport: createFoundryMarker("20260424T110000000Z-foundry-export.ndjson"),
        foundryScheduledFilenames: [
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T110000000Z-foundry-export.ndjson"
        ]
      })
    );

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      status: "failed"
    });
    expect(savedStates).toHaveLength(1);
    expect(savedStates[0]?.foundry.appliedExportFilenames).toEqual(["20260424T100000000Z-foundry-export.ndjson"]);
    expect(readRows(config, "SELECT source_key FROM sources WHERE source_type = 'foundry'")).toEqual([
      {
        source_key: "actor-1"
      }
    ]);
  });

  it("replays Foundry history for a late backfilled delta without removing other source types", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const seedStore = createSqliteCorpusStore();
    stores.push(seedStore);
    await seedStore.initialize(config);
    await seedStore.replaceSource(config, {
      sourceId: "pdf:existing.pdf",
      sourceType: "pdf",
      sourceKey: "existing.pdf",
      title: "Existing PDF",
      metadata: {},
      status: "succeeded"
    }, []);
    await seedStore.replaceSource(config, {
      sourceId: "foundry:stale",
      sourceType: "foundry",
      sourceKey: "stale",
      title: "Stale Foundry",
      metadata: {},
      status: "succeeded"
    }, []);

    await writeDeltaExport(config, "20260424T100000000Z-foundry-export.ndjson", "run-10", [
      upsertRecord({ recordId: "actor-1", sourceType: "Actor", name: "Ashana", body: "Version 10." })
    ]);
    await writeDeltaExport(config, "20260424T110000000Z-foundry-export.ndjson", "run-11", [
      upsertRecord({ recordId: "actor-2", sourceType: "Actor", name: "Bryn", body: "Version 11." })
    ], { recordCount: 2 });
    await writeDeltaExport(config, "20260424T120000000Z-foundry-export.ndjson", "run-12", [
      deleteRecord("actor-1")
    ], { recordCount: 1 });
    await writeDeltaExport(config, "20260424T130000000Z-foundry-export.ndjson", "run-13", [
      upsertRecord({ recordId: "actor-3", sourceType: "Actor", name: "Cazha", body: "Version 13." })
    ], { recordCount: 2 });

    const state = createDefaultRuntimeState();
    state.foundry.appliedExportFilenames = [
      "20260424T100000000Z-foundry-export.ndjson",
      "20260424T110000000Z-foundry-export.ndjson",
      "20260424T130000000Z-foundry-export.ndjson"
    ];
    state.foundry.lastSuccessfulExport = createFoundryMarker("20260424T130000000Z-foundry-export.ndjson");

    const result = await createService().ingest(
      config,
      { forceReingest: false },
      state,
      scheduledDiscovery(state, ["foundry"], {
        foundryAppliedFilenames: [
          "20260424T100000000Z-foundry-export.ndjson",
          "20260424T110000000Z-foundry-export.ndjson",
          "20260424T120000000Z-foundry-export.ndjson",
          "20260424T130000000Z-foundry-export.ndjson"
        ],
        foundryLastSuccessfulExport: createFoundryMarker("20260424T130000000Z-foundry-export.ndjson"),
        foundryScheduledFilenames: ["20260424T120000000Z-foundry-export.ndjson"]
      })
    );

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "foundry")).toMatchObject({
      removed: 1,
      status: "succeeded"
    });
    expect(result.nextState.foundry.lastSuccessfulExport?.filename).toBe("20260424T130000000Z-foundry-export.ndjson");
    expect(readRows(config, "SELECT source_type, source_key, title FROM sources ORDER BY source_type, source_key")).toEqual([
      {
        source_type: "foundry",
        source_key: "actor-2",
        title: "Bryn"
      },
      {
        source_type: "foundry",
        source_key: "actor-3",
        title: "Cazha"
      },
      {
        source_type: "pdf",
        source_key: "existing.pdf",
        title: "Existing PDF"
      }
    ]);
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

  it("caches Keith Baker index and article raw HTML after a successful article ingest", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    const indexUrl = "https://keith-baker.com/eberron-index/";
    const articleUrl = "https://keith-baker.com/cached-article/";
    const indexHtml = '<main><a href="/cached-article/">Cached</a></main>';
    const articleHtml = "<article><h1>Cached Article</h1><p>House Sivis keeps careful records.</p></article>";
    const fetcher = createMapArticleFetcher(
      new Map([
        [indexUrl, indexHtml],
        [articleUrl, articleHtml]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["article"]));

    const cache = createFilesystemArticleRawCache();
    await expect(cache.read(config, indexUrl)).resolves.toBe(indexHtml);
    await expect(cache.read(config, articleUrl)).resolves.toBe(articleHtml);
  });

  it("uses cached article raw HTML during force reingest without fetching the article page", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const cache = createFilesystemArticleRawCache();
    const articleUrl = "https://keith-baker.com/cached-force/";
    await cache.write(
      config,
      articleUrl,
      "<article><h1>Cached Force</h1><p>The cached version rebuilds the corpus.</p></article>"
    );

    const state = createDefaultRuntimeState();
    state.article.knownArticles = [
      {
        canonicalUrl: articleUrl,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: "2026-04-20T10:00:00.000Z",
        scrapeStatus: "succeeded",
        title: "Old Title"
      }
    ];

    const fetchedUrls: string[] = [];
    const fetcher: ArticleFetcher = {
      fetchText(url) {
        fetchedUrls.push(url);
        if (url === "https://keith-baker.com/eberron-index/") {
          return Promise.resolve('<main><a href="/cached-force/">Cached Force</a></main>');
        }
        throw createTaggedError("unexpected-article-fetch", `Unexpected article fetch: ${url}`);
      }
    };

    const service = createService({ articleFetcher: fetcher });
    const result = await service.ingest(config, { forceReingest: true }, state, scheduledDiscovery(state, ["article"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "article")).toMatchObject({
      ingested: 1,
      status: "succeeded"
    });
    expect(fetchedUrls).toEqual(["https://keith-baker.com/eberron-index/"]);
    expect(readRows(config, "SELECT source_key, title FROM sources")).toEqual([
      {
        source_key: articleUrl,
        title: "Cached Force"
      }
    ]);
  });

  it("fetches and caches force reingest article cache misses", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const state = createDefaultRuntimeState();
    const articleUrl = "https://keith-baker.com/cache-miss/";
    const articleHtml = "<article><h1>Cache Miss</h1><p>The live page fills the missing cache.</p></article>";
    state.article.knownArticles = [
      {
        canonicalUrl: articleUrl,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: "2026-04-20T10:00:00.000Z",
        scrapeStatus: "succeeded",
        title: "Cache Miss"
      }
    ];
    const fetcher = createMapArticleFetcher(
      new Map([
        ["https://keith-baker.com/eberron-index/", '<main><a href="/cache-miss/">Cache Miss</a></main>'],
        [articleUrl, articleHtml]
      ])
    );

    const service = createService({ articleFetcher: fetcher });
    await service.ingest(config, { forceReingest: true }, state, scheduledDiscovery(state, ["article"]));

    await expect(createFilesystemArticleRawCache().read(config, articleUrl)).resolves.toBe(articleHtml);
  });

  it("uses the cached Keith Baker index during force reingest when the live index fetch fails", async () => {
    const config = loadDefaultConfig(TEST_ROOT);
    const cache = createFilesystemArticleRawCache();
    const articleUrl = "https://keith-baker.com/cached-index/";
    await cache.write(config, "https://keith-baker.com/eberron-index/", '<main><a href="/cached-index/">Cached Index</a></main>');
    await cache.write(
      config,
      articleUrl,
      "<article><h1>Cached Index</h1><p>The index cache protects force reingest.</p></article>"
    );
    const state = createDefaultRuntimeState();
    state.article.knownArticles = [
      {
        canonicalUrl: articleUrl,
        firstSeenAt: "2026-04-20T10:00:00.000Z",
        lastIngestedAt: "2026-04-20T10:00:00.000Z",
        scrapeStatus: "succeeded",
        title: "Cached Index"
      }
    ];

    const service = createService({
      articleFetcher: {
        fetchText: () => {
          throw createTaggedError("index-down", "simulated index outage");
        }
      }
    });
    const result = await service.ingest(config, { forceReingest: true }, state, scheduledDiscovery(state, ["article"]));

    expect(result.summary.sourceSummaries.find((summary) => summary.sourceType === "article")).toMatchObject({
      ingested: 1,
      status: "succeeded"
    });
    expect(readRows(config, "SELECT source_key, title FROM sources")).toEqual([
      {
        source_key: articleUrl,
        title: "Cached Index"
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
      '<html lang="en"><head><title>Example Article - Keith Baker&apos;s Blog</title><meta property="og:title" content="Example Article"></head><body><article><p>Dragonmarks matter.</p></article></body></html>',
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
    const result = await service.ingest(config, { forceReingest: false }, state, discovery);

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
    const result = await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, ["article"]));

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
    await expect(createFilesystemArticleRawCache().read(config, "https://keith-baker.com/new-article/")).resolves.toBeNull();
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
    const result = await service.ingest(config, { forceReingest: true }, state, scheduledDiscovery(state, ["article"]));

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

    await service.ingest(config, { forceReingest: false }, state, scheduledDiscovery(state, []));
    await service.ingest(config, { forceReingest: true }, state, scheduledDiscovery(state, []));

    expect(corpusStoreFixture.initialize).toHaveBeenNthCalledWith(1, config, { allowIncompatibleReset: false });
    expect(corpusStoreFixture.initialize).toHaveBeenNthCalledWith(2, config, { allowIncompatibleReset: true });
    expect(corpusStoreFixture.clear).toHaveBeenCalledTimes(1);
    expect(corpusStoreFixture.clear).toHaveBeenCalledWith(config);
  });
});

const createService = (
  options: { articleFetcher?: ArticleFetcher; articleRawCache?: ArticleRawCache; pdfParser?: PdfParser; stateStore?: StateStore } = {}
) => {
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
    ...(options.stateStore ? { stateStore: options.stateStore } : {}),
    ...(options.articleRawCache ? { articleRawCache: options.articleRawCache } : {}),
    ...(options.articleFetcher ? { articleFetcher: options.articleFetcher } : {})
  };
  return createFilesystemIngestionService({
    ...dependencies
  });
};

const scheduledDiscovery = (
  state: RuntimeState,
  scheduled: Array<"foundry" | "pdf" | "article">,
  options: {
    foundryAppliedFilenames?: string[];
    foundryLastSuccessfulExport?: RuntimeState["foundry"]["lastSuccessfulExport"];
    foundryScheduledFilenames?: string[];
  } = {}
): SourceDiscoverySummary => {
  const nextState = createDefaultRuntimeState();
  const foundryScheduledFilenames = options.foundryScheduledFilenames ?? ["20260424T100000000Z-foundry-export.ndjson"];
  nextState.foundry.appliedExportFilenames = options.foundryAppliedFilenames ?? foundryScheduledFilenames;
  nextState.foundry.lastSuccessfulExport = options.foundryLastSuccessfulExport ?? createFoundryMarker(foundryScheduledFilenames.at(-1));
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
        details: scheduled.includes("foundry") ? foundryScheduledFilenames.map((filename) => `scheduled:${filename}`) : []
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

const createFoundryMarker = (filename = "20260424T100000000Z-foundry-export.ndjson") => ({
  deleteCount: 0,
  filename,
  generatedAt: "2026-04-24T10:00:00.000Z",
  recordCount: 1,
  runId: filename,
  schemaVersion: "2.0.0",
  upsertCount: 1
});

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

const writeDeltaExport = async (
  config: ReturnType<typeof loadDefaultConfig>,
  filename: string,
  runId: string,
  operations: Array<{ kind: "delete" | "upsert"; record: Record<string, unknown> }>,
  manifestOverrides: Partial<ReturnType<typeof validManifest>["run"]> = {}
) => {
  await mkdir(config.foundryExportDir, { recursive: true });
  const upsertCount = operations.filter((operation) => operation.kind === "upsert").length;
  const deleteCount = operations.filter((operation) => operation.kind === "delete").length;
  await writeFile(
    path.join(config.foundryExportDir, filename),
    [
      JSON.stringify({
        kind: "manifest",
        manifest: validManifest(runId, upsertCount, deleteCount, {
          recordCount: upsertCount,
          ...manifestOverrides
        })
      }),
      ...operations.map((operation) => JSON.stringify(operation))
    ].join("\n") + "\n",
    "utf8"
  );
};

const validManifest = (
  runId: string,
  upsertCount: number,
  deleteCount: number,
  runOverrides: Partial<{
    deleteCount: number;
    generatedAt: string;
    recordCount: number;
    runId: string;
    upsertCount: number;
  }> = {}
) => ({
  schemaVersion: "2.0.0",
  run: {
    deleteCount,
    generatedAt: "2026-04-24T10:00:00.000Z",
    recordCount: upsertCount,
    runId,
    upsertCount,
    ...runOverrides
  }
});

const upsertRecord = (record: Record<string, unknown>) => ({
  kind: "upsert" as const,
  record
});

const deleteRecord = (recordId: string) => ({
  kind: "delete" as const,
  record: {
    recordId
  }
});

const cloneRuntimeState = (state: RuntimeState): RuntimeState => ({
  appVersion: state.appVersion,
  foundry: {
    appliedExportFilenames: [...state.foundry.appliedExportFilenames],
    lastSuccessfulExport: state.foundry.lastSuccessfulExport ? { ...state.foundry.lastSuccessfulExport } : null
  },
  pdf: {
    knownFilenames: [...state.pdf.knownFilenames]
  },
  article: {
    lastSuccessfulIndexScrapeAt: state.article.lastSuccessfulIndexScrapeAt,
    knownArticles: state.article.knownArticles.map((article) => ({ ...article }))
  }
});

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
      applySourceChanges: vi.fn<CorpusStore["applySourceChanges"]>().mockResolvedValue(undefined),
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
