# Eberron Query Assistant Specification

## Summary
`eberron-query-assistant` is part 2 of a two-part workflow. Part 1 exports Foundry VTT world data into a manifest plus NDJSON corpus. Part 2 consumes that foundry export, a local library of PDFs, and scraped Keith Baker articles to build and maintain a retrieval layer for an interactive assistant.

The final product is a Node.js CLI application that refreshes its corpus on launch, then opens an interactive chat session. The product is terminal-only and is not expected to gain a GUI. The assistant must answer direct questions and inference-heavy questions, and should cite PDFs, articles, and foundry entities whenever possible.

This file defines the finished system. Phased delivery is defined separately in `docs/phase-*.md`.

## Goals
- Build a repeatable ingestion pipeline for three source classes:
  - Foundry export data in `foundry-export/`
  - Local PDFs in `pdf/`
  - Keith Baker articles discovered from `https://keith-baker.com/eberron-index/`
- Maintain a retrieval layer optimized for assistant queries and source-aware responses.
- Support incremental updates on startup so unchanged content is skipped.
- Provide a terminal-only user experience with progress reporting during refresh and an interactive chat session afterward.
- Support both retrieval questions and synthesis/inference questions across multiple sources.

## Non-Goals
- Persist chat memory across application runs.
- Build any GUI.
- Recompute PDF parsing when the filename is unchanged.
- Re-scrape Keith Baker articles that were already captured successfully unless a full refresh is forced.
- Turn the application into a long-running service or daemon.

## Source Inputs And Directory Conventions
The repository is expected to use these default source locations:

- `foundry-export/manifest.json`: trusted manifest for the latest Foundry export run
- `foundry-export/records.ndjson`: exported Foundry records corpus
- `pdf/`: local PDF corpus

The application keeps its local runtime artifacts under `.eberron-query-assistant/` by default. Unless a later approved change introduces an override, this directory is the default location for:
- ingestion metadata
- source fingerprints and scrape history
- normalized corpus data
- SQLite and vector retrieval artifacts
- parse and scrape caches

## Technology Baseline
- Runtime: Node.js
- Language: TypeScript
- Module system: ESM-first unless a concrete dependency forces a different layout
- Test framework: Vitest
- Linting: ESLint
- Normalized corpus store: SQLite via `better-sqlite3`
- PDF parsing: `pdfdataextract`
- HTML parsing for article discovery and extraction: `cheerio`

Implementation must preserve clear boundaries between configuration, CLI/runtime flow, source discovery, persistence/state, ingestion pipelines, retrieval/indexing, and provider adapters.

The project should be structured so unit tests can cover source-specific logic without requiring a live model provider or network access for most cases.

## Product Behavior

### Launch Flow
Every application start must follow this sequence:

1. Resolve runtime options from the repo-local package script and initialize logging/progress output.
2. Load persisted runtime state.
3. Refresh source inventories and update the retrieval layer incrementally.
4. Report startup completion or degraded-state warnings.
5. Launch the interactive assistant loop.
6. Continue until the process is terminated.

The refresh step is mandatory on startup unless a later approved change adds an explicit bypass mode. The default behavior is refresh-first, chat-second.

### CLI Feedback
The application must print progress to the terminal during startup work. The output does not need to be flashy, but it must make the current action legible. At minimum it should indicate:
- source inventory checks beginning and ending
- whether each source was skipped, refreshed, added, updated, or removed
- counts for discovered, added, updated, removed, and failed items where applicable
- retrieval-layer rebuild or update progress
- startup completion state before the assistant starts

If startup proceeds with partial failures, the terminal output must say so clearly and identify which source type degraded.

### Force Re-Ingest
The package scripts must expose a full re-ingest command.

When full re-ingest is requested:
- ignore normal incremental skip logic for foundry export, PDFs, and scraped articles
- rebuild retrieval artifacts from source material
- refresh scrape targets even if the one-week interval has not elapsed
- make it explicit in progress output that a full rebuild is occurring

## Incremental Update Rules

### Persisted Runtime State
The application must maintain a persisted local state record separate from the Foundry export. This state must include at minimum:
- app version that wrote the runtime state
- last processed Foundry export marker
- known PDF filenames
- known Keith Baker article URLs and scrape status
- last successful Keith Baker index scrape timestamp
- retrieval-layer bookkeeping sufficient to delete stale entries

This state is the basis for incremental startup decisions.

Runtime state uses `appVersion` as its compatibility marker. Each implementation phase increments the minor application version to match the phase number. If the stored `appVersion` is missing or differs from the actual app version, startup must invalidate the stored runtime state, clear app-owned runtime artifacts, and continue from default state for the current version.

### Foundry Export Handling
The application must inspect `foundry-export/` on every startup.

Required behavior:
- Read and trust `foundry-export/manifest.json`.
- Determine whether the Foundry export changed since the last successful ingest using a fast marker.
- Re-ingest Foundry data only when the export changed or when a full re-ingest is forced.
- Detect additions, updates, and removals in foundry-derived records so the retrieval layer stays aligned with the latest export.

Recommended default change marker:
- Use `run.generatedAt` plus `run.runId` from the manifest as the primary export identity.
- Persist `recordCount` as a sanity check.
- Optionally add a manifest file hash if stronger tamper detection is later needed.

The implementation should not scan the NDJSON file to determine whether to skip work if the manifest indicates the export is unchanged.

Foundry ingestion output must preserve source metadata that supports citations, at minimum:
- source type: `foundry`
- entity kind if available
- entity name or title
- stable record identifier if present
- export run identifier

### PDF Handling
The application must inspect the `pdf/` directory on every startup.

Required behavior:
- Discover current PDF filenames.
- Ingest newly added filenames.
- Remove retrieval-layer entries for filenames no longer present.
- Do not reprocess PDFs whose filename is unchanged unless a full re-ingest is forced.

Assumptions:
- PDF content is treated as immutable when the filename is unchanged.
- Filenames are the identity key for incremental decisions.

PDF ingestion output must preserve source metadata that supports citations, at minimum:
- source type: `pdf`
- filename
- friendly title derived from filename or embedded metadata if available
- page-level or page-range references where supported by the parser

### Keith Baker Article Discovery And Scraping
The application must inspect `https://keith-baker.com/eberron-index/` as the source of candidate article URLs.

Required behavior:
- Scrape only links from the content area of the index page.
- Compare discovered article URLs against persisted scrape history.
- Fetch and ingest only new articles by default.
- Skip the index scrape entirely if the last completed scrape was less than one week ago.
- Allow the full re-ingest command to bypass the one-week skip.
- Avoid re-scraping previously captured article pages unless a force refresh is requested.

Persist for each article:
- canonical URL
- title
- first-seen timestamp
- last-ingested timestamp
- scrape status
- content hash or revision marker if later article refresh support is added

Article ingestion output must preserve source metadata that supports citations, at minimum:
- source type: `article`
- URL
- title
- section or heading markers where extractable

### Partial Failure Behavior
Startup refresh must be resilient.

Required behavior:
- Failure in one source pipeline must not automatically prevent the others from running.
- If at least one source remains available, the assistant may start in degraded mode after reporting the failure.
- If no retrieval corpus can be produced, startup must fail before entering chat.
- Persisted state must only be updated for work that completed successfully enough to trust.

This requires source-scoped transactions or equivalent safeguards so a failed ingest does not silently mark incomplete work as current.

## Retrieval Architecture
The retrieval layer is finalized as a hybrid design: SQLite metadata plus vector retrieval.

### Required Capabilities
The retrieval design must support:
- mixed-source indexing across foundry, PDF, and article inputs
- chunk-level storage plus source metadata
- filtering by source type and source identifier
- removal of stale chunks when sources disappear
- citation-friendly retrieval results
- compatibility with both lookup-style and inference-style prompts
- deterministic local refresh behavior driven by persisted state

### Selected Design
The project uses a hybrid retrieval model:
- normalized source and chunk metadata stored in SQLite
- lexical lookup and metadata filtering driven by SQLite
- a companion vector index keyed by `chunk_id` for semantic recall

Reasoning:
- the corpus mixes structured Foundry entities with long-form PDF and article text
- the assistant must answer both direct lookup and inference-heavy questions
- citation quality and incremental deletions matter
- keeping metadata authoritative in SQLite makes debugging and removals easier

SQLite is the authoritative persistence layer. The vector index is a retrieval accelerator keyed by `chunk_id` and can be rebuilt from SQLite-backed source and chunk records if needed.

### Required Retrieval Structures
The retrieval layer must include:
- a `sources` table for source-level metadata and ingest status
- a `chunks` table for normalized chunk content and citation metadata
- FTS support for lexical fallback and exact-term queries
- a vector index keyed by `chunk_id`
- deletion and update routines driven by source identifiers so stale records are removed cleanly

## Assistant Runtime

### Session Model
After startup refresh completes, the application launches an interactive terminal chat session.

Required behavior:
- no cross-session memory
- session lasts until process termination
- `Ctrl+C` is sufficient to end the process unless the chosen provider SDK requires explicit shutdown

Conversation state may exist only in memory for the current run.

### Query Handling
The assistant must support:
- direct lookup questions
- source-comparison questions
- inference questions spanning multiple retrieved snippets
- questions about player and NPC connections in foundry data
- lore and thematic questions grounded in PDFs and Keith Baker articles

The runtime must:
- transform the user query into retrieval requests
- collect relevant chunks and metadata
- construct a prompt that separates evidence from instructions
- generate an answer that distinguishes direct support from inference when appropriate

### Response Requirements
Each answer should include:
- a direct response or summary when the question warrants one
- references to supporting sources when available

Preferred reference formats:
- PDFs: title or filename plus page or page-range if available
- articles: article title plus URL
- foundry data: entity name and type, plus a stable identifier when useful

Inference-heavy responses must avoid pretending a conclusion is directly quoted when it is synthesized from multiple sources.

## Public Interfaces And Configuration

### CLI Interface
The project is used from the repository through package scripts. The application must expose:
- `npm run start`: perform startup refresh and enter chat
- `npm run reingest`: perform a full source re-ingest and retrieval rebuild, then enter chat
- `npm run debug:retrieval -- "<query>"`: perform startup refresh, print retrieval results for the provided query, and exit without entering chat

Script internals may use CLI flags or other implementation details, but the user-facing command surface should not require routing flags through `npm run ... --` except when passing the retrieval query to `debug:retrieval`.

### Provider Boundary
The runtime uses an OpenAI-compatible provider interface for chat and embeddings. Provider integration must be compartmentalized so changing the model provider later only requires touching a small number of files.

Required provider boundary:
- a provider adapter module for chat completions
- a provider adapter module for embeddings
- configuration isolated from ingestion and retrieval logic
- assistant runtime code that depends on provider interfaces rather than provider-specific SDK calls scattered across the codebase

### Environment And Local Paths
Configuration should stay minimal unless implementation reveals a clear need to expand it. Prefer:
- sensible repo-local defaults for source directories
- environment variables for provider credentials and model identifiers
- optional config extension only when it meaningfully improves operation

Default local paths:
- `.eberron-query-assistant/state/` for runtime state
- `.eberron-query-assistant/cache/` for scrape and parse caches
- `.eberron-query-assistant/retrieval/` for SQLite and vector artifacts

## Validation Expectations

### Automated Coverage
At minimum, automated tests should cover:
- manifest-based change detection
- PDF inventory diffing
- scrape cadence and dedupe rules
- source normalization and metadata retention
- state commit and rollback behavior on failure
- retrieval deletion behavior for removed sources
- answer citation formatting

### Manual Validation
Manual verification across the finished system must include:
- startup with no source changes
- startup with Foundry export changes
- startup after PDF additions
- startup after PDF removals
- startup with new Keith Baker links discovered
- startup while the scrape interval has not elapsed
- startup through `npm run reingest`
- answer generation for both retrieval-heavy and inference-heavy questions

### Acceptance Scenarios
The finished system must satisfy these scenarios:

1. Unchanged launch:
- application reports that sources are unchanged and avoids unnecessary refresh work
- assistant still starts normally

2. Foundry update:
- changed manifest triggers Foundry re-ingest
- retrieval layer reflects additions, updates, and removals

3. PDF delta:
- new PDF is ingested
- removed PDF is deleted from the retrieval layer
- unchanged PDF is skipped

4. Weekly scrape rule:
- recent successful scrape skips the index crawl
- older scrape timestamp causes index crawl and new-article ingest

5. Force rebuild:
- all source classes are reprocessed regardless of normal skip rules
- retrieval artifacts are rebuilt cleanly

6. Citation-aware answering:
- answers include useful references for supporting sources
- inference-heavy answers do not misrepresent synthesis as a direct quote

## Assumptions And Finalized Decisions

### Assumptions
- `foundry-export/manifest.json` is trusted.
- `foundry-export/records.ndjson` is the canonical Foundry record corpus.
- PDF identity is filename-based for incremental decisions.
- The project is a local CLI tool rather than a service.
- Provider credentials can be supplied via environment variables.

### Finalized Decisions
- Retrieval layer: hybrid SQLite metadata plus vector retrieval
- Provider model family: OpenAI-compatible chat and embeddings behind a compartmentalized adapter boundary
- Default runtime state location: `.eberron-query-assistant/`
- Canonical runtime commands: `npm run start`, `npm run reingest`, and `npm run debug:retrieval -- "<query>"`

## README Alignment Requirements
When `README.md` is written or updated, it must remain consistent with this specification and present the project as a finished product. It should summarize:
- what the tool ingests
- what happens on startup
- how the interactive assistant behaves
- how to run it
- what kind of references users should expect in answers

It must not duplicate implementation phase details or internal authoring rules.
