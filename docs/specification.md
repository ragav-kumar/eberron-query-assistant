# Eberron Query Assistant Specification

## Summary
`eberron-query-assistant` is part 2 of a two-part workflow. Part 1 exports Foundry VTT world data into a manifest plus NDJSON corpus. Part 2 consumes that foundry export, a local library of PDFs, and scraped Keith Baker articles to build and maintain a retrieval layer for an interactive assistant.

The final product is a Node.js CLI application that refreshes its corpus on launch, then opens an interactive chat session. The product is terminal-only and is not expected to gain a GUI. The assistant must answer direct questions and inference-heavy questions, and should cite PDFs, articles, and foundry entities whenever possible.

This specification is the single authoritative engineering plan for the repository. It is intentionally exhaustive so implementation work can proceed phase by phase without inventing behavior midstream.

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
- Recompute PDF parsing when the file name is unchanged.
- Re-scrape Keith Baker articles that were already captured successfully.
- Treat `foundry-export/manifest.json` as untrusted input; the brief explicitly says it can be trusted.

## Source Inputs And Directory Conventions
The current repository layout is the planning baseline:

- `foundry-export/manifest.json`: trusted manifest for the latest foundry export run
- `foundry-export/records.ndjson`: exported records corpus
- `pdf/`: local PDF corpus
- `docs/`: specifications and temporary planning materials

The current manifest shape shows:
- `schemaVersion`
- `run.generatedAt`
- `run.runId`
- `run.exportFormat`
- `run.recordCount`
- file entries for records and manifest
- a Foundry sync state reference

The application will keep its local runtime state under a repo-local `.eberron-query-assistant/` directory. This directory is the default location for ingestion metadata, source fingerprints, scrape history, normalized corpus data, and retrieval artifacts unless a later approved change introduces an override.

## Technical Baseline
- Runtime: Node.js
- Language: TypeScript
- Test framework: Vitest
- Linting: ESLint

Implementation should prefer:
- ESM-first TypeScript configuration unless a concrete library choice forces a different layout
- a CLI entrypoint suitable for local execution via npm scripts
- isolated modules for source discovery, ingestion, retrieval, assistant runtime, and persistence/state tracking

The project should be structured so unit tests can cover source-specific logic without requiring a live model provider or network access for most cases.

## Product Behavior

### Launch Flow
Each application start must follow this sequence:

1. Parse CLI flags and initialize logging/progress output.
2. Load persisted ingestion state.
3. Refresh source inventories and update the retrieval layer incrementally.
4. Report startup completion or any degraded-state warnings.
5. Launch the interactive assistant loop.
6. Continue until the process is terminated.

The refresh step is mandatory on startup unless later instructions add an explicit bypass mode. The default behavior is refresh-first, chat-second.

### CLI Feedback
The application must print progress to the terminal during startup work. The output does not need to be flashy, but it must make the current action legible. At minimum it should indicate:
- source inventory checks beginning and ending
- whether a source was skipped or refreshed
- counts for discovered, added, updated, removed, and failed items where applicable
- retrieval-layer rebuild or update progress
- completion state before the assistant starts

If startup proceeds with partial failures, the terminal output must say so clearly and identify which source type degraded.

### Force Re-Ingest
The CLI must support a `--force-reingest` flag that triggers a full re-ingest.

When the force flag is present:
- ignore normal incremental skip logic for foundry export, PDFs, and scraped articles
- rebuild retrieval artifacts from source material
- refresh scrape targets even if the one-week interval has not elapsed
- keep progress output explicit so the user can tell a full rebuild is happening

## Ingestion And Incremental Update Rules

### Persisted Runtime State
The application must maintain a persisted local state record separate from the foundry export. This state should include at minimum:
- last processed foundry export marker
- known PDF filenames
- known Keith Baker article URLs and scrape status
- last successful Keith Baker index scrape timestamp
- retrieval-layer bookkeeping sufficient to delete stale entries
- versioning for local state so future migrations are possible

This state is the basis for incremental startup decisions.

### Foundry Export Handling
The application must inspect `foundry-export/` on every startup.

Required behavior:
- Read and trust `foundry-export/manifest.json`.
- Determine whether the foundry export changed since the last successful ingest using a fast marker.
- Re-ingest foundry data only when the export changed or when a full re-ingest is forced.
- Detect additions, updates, and removals in foundry-derived records so the retrieval layer stays aligned with the latest export.

Recommended default change marker:
- Use `run.generatedAt` plus `run.runId` from the manifest as the primary export identity.
- Persist `recordCount` as a sanity check.
- Optionally add a manifest file hash if implementation wants stronger tamper detection.

The implementation should not scan the NDJSON file to determine whether to skip work if the manifest indicates the export is unchanged.

Foundry ingestion output must preserve source metadata that supports citations, at minimum:
- source type (`foundry`)
- entity kind if available
- entity name/title
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
- source type (`pdf`)
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
- Allow the force full re-ingest flag to bypass the one-week skip.
- Avoid re-scraping previously captured article pages unless a force refresh is requested.

Persist for each article:
- canonical URL
- title
- first-seen timestamp
- last-ingested timestamp
- scrape status
- content hash or revision marker if later refresh support is added

Article ingestion output must preserve source metadata that supports citations, at minimum:
- source type (`article`)
- URL
- title
- section or heading markers where extractable

### Partial Failure Behavior
Startup refresh must be resilient.

Required behavior:
- Failure in one source pipeline must not automatically prevent the others from running.
- If at least one source remains available, the assistant may start in degraded mode after reporting the failure.
- If no retrieval corpus can be produced, startup should fail before entering chat.
- Persisted state must only be updated for work that completed successfully enough to trust.

This means the implementation needs source-scoped transactions or equivalent safeguards so a failed ingest does not silently mark incomplete work as current.

## Retrieval Layer Design
The retrieval layer is finalized in this specification as a hybrid design: SQLite metadata plus vector retrieval.

### Mandatory Capabilities
Any accepted retrieval-layer design must support:
- mixed-source indexing across foundry, PDF, and article inputs
- chunk-level storage plus source metadata
- filtering by source type and source identifier
- removal of stale chunks when sources disappear
- citation-friendly retrieval results
- compatibility with both lookup-style and inference-style prompts
- deterministic local refresh behavior driven by persisted state

### Rejected Option A: File-Backed Local Corpus Plus Embedded Vector Store
Description:
- normalize each source into structured chunk documents on disk
- generate embeddings for chunks
- store vectors in a local embedded database or file-backed vector index
- retrieve semantically relevant chunks for assistant prompts

Pros:
- good fit for natural-language retrieval over PDFs and articles
- local-first runtime model
- straightforward chunk-level citations
- flexible enough for foundry entities and unstructured prose

Cons:
- requires embedding generation pipeline
- introduces vector database selection and persistence concerns
- removal and migration logic must stay disciplined

### Rejected Option B: SQLite-Centered Corpus With FTS And Structured Metadata
Description:
- store normalized chunks and metadata in SQLite
- use FTS for keyword retrieval
- optionally layer embeddings later if plain FTS proves insufficient

Pros:
- simple deployment footprint
- strong inspectability and easy debugging
- good fit for deterministic metadata filters and exact-match queries
- easier deletion and incremental bookkeeping

Cons:
- weaker semantic recall for paraphrased or inference-heavy questions without an embedding layer
- may require more prompt-time query orchestration

### Selected Design: Hybrid SQLite Metadata Plus Vector Retrieval
Description:
- keep normalized chunk and source metadata in SQLite
- maintain a companion vector index keyed by chunk id
- use metadata filtering and lexical lookup through SQLite, with semantic recall through vectors

Pros:
- strongest balance of inspectability, deletion support, and semantic retrieval
- good path for mixed structured/unstructured sources
- clear citation and provenance mapping through chunk ids

Cons:
- highest implementation complexity
- requires coordination across two persistence mechanisms

### Finalized Decision
The project will use the hybrid design described above.

Reasoning:
- the corpus mixes structured foundry entities with long-form PDF and article text
- the assistant must answer both direct lookup and inference-heavy questions
- citation quality and incremental deletions matter
- keeping metadata authoritative in SQLite makes debugging and removals easier

Implementation shape:
- early phases can normalize content into SQLite-backed source and chunk tables first
- retrieval can begin with metadata filters and lexical search
- semantic vector retrieval can be added in the retrieval integration phase without discarding the corpus model

SQLite is the authoritative persistence layer. The vector index is a retrieval accelerator keyed by `chunk_id` and can be rebuilt from SQLite-backed source and chunk records if needed.

The retrieval layer must include:
- a `sources` table for source-level metadata and ingest status
- a `chunks` table for normalized chunk content and citation metadata
- FTS support for lexical fallback and exact-term queries
- a vector index keyed by `chunk_id`
- deletion/update routines driven by source identifiers so stale records are removed cleanly

## Assistant Runtime Behavior

### Session Model
After startup refresh completes, the application launches an interactive terminal chat session.

Required behavior:
- no cross-session memory
- session lasts until process termination
- Ctrl+C is sufficient to end the process unless the chosen AI provider SDK requires explicit shutdown

Conversation state may exist only in memory for the current run.

### Query Handling
The assistant must support:
- direct lookup questions
- source-comparison questions
- inference questions spanning multiple retrieved snippets
- questions about player and NPC connections in foundry data
- lore and thematic questions grounded in PDFs and Keith Baker articles

The assistant runtime should:
- transform the user query into retrieval requests
- collect relevant chunks and metadata
- construct a prompt that separates evidence from instructions
- generate an answer that distinguishes direct citations from inference when appropriate

### Response Requirements
Each answer should include:
- a direct response or summary when the question warrants one
- references to supporting sources when available

Preferred reference formats:
- PDFs: title or filename plus page/page-range if available
- articles: article title plus URL
- foundry data: entity name and type, and a stable identifier if useful

Inference responses should avoid pretending a conclusion is directly quoted when it is synthesized from multiple sources.

## Public Interfaces And Expected Inputs

### CLI Interface
The exact CLI package and parser can be chosen during implementation, but the application must expose:
- a default command that performs startup refresh and enters chat
- a `--force-reingest` flag
- optional future flags for verbosity, model/provider selection, or source filtering

### Environment And Configuration
The repo currently includes `.env`, and the runtime should use an OpenAI-compatible provider interface for chat and embeddings. Provider integration must be compartmentalized so changing the model provider later only requires touching a small number of files.

Required provider boundary:
- a provider adapter module for chat completions
- a provider adapter module for embeddings
- configuration isolated from ingestion and retrieval logic
- assistant runtime code that depends on provider interfaces rather than provider-specific SDK calls scattered across the codebase

Configuration should be kept minimal in the first pass. Prefer:
- sensible repo-local defaults for source directories
- environment variables for provider credentials and model identifiers
- optional config extension only if implementation reveals clear need

Default local paths:
- `.eberron-query-assistant/state/` for runtime state
- `.eberron-query-assistant/cache/` for scrape and parse caches
- `.eberron-query-assistant/retrieval/` for SQLite and vector artifacts

## Phased Implementation Plan

### Phase 1: Project Scaffold And CLI Foundation
Goal:
- establish the TypeScript/Node/Vitest/ESLint project structure and a CLI entrypoint

Scope:
- initialize package metadata and scripts
- configure TypeScript, Vitest, and ESLint
- create the CLI startup flow skeleton
- implement terminal progress/logging primitives
- define initial module boundaries for config, source discovery, state, ingestion, retrieval, and chat runtime

Excluded work:
- real ingestion logic
- retrieval implementation
- model-provider integration

Tests to add:
- config loading tests
- CLI argument parsing tests
- progress/log formatting tests where practical

Human verification:
- install dependencies successfully
- run lint and tests successfully
- run the CLI and see startup placeholders followed by a stub interactive prompt

### Phase 2: Source Discovery And Persisted State
Goal:
- detect source inventories and track what has been processed before

Scope:
- implement persisted runtime state storage
- read and validate trusted foundry manifest shape
- discover current PDFs by filename
- implement Keith Baker scrape cadence checks without full article ingestion yet
- compute source inventory deltas and skip decisions

Excluded work:
- full parsing of PDF text
- article content scraping
- retrieval queries

Tests to add:
- foundry manifest marker tests
- PDF add/remove detection tests
- weekly scrape skip logic tests
- state persistence/load tests

Human verification:
- run the tool twice with no changes and confirm skip messaging appears
- add a PDF filename and confirm it is detected as new
- remove a PDF filename and confirm removal is detected
- simulate an old scrape timestamp and confirm the index check is scheduled

### Phase 3: Ingestion Pipelines
Goal:
- convert all supported sources into normalized source and chunk records

Scope:
- parse foundry NDJSON into normalized entities/chunks
- parse PDFs into chunked text with page metadata
- scrape new Keith Baker article pages and normalize article content
- persist normalized corpus data and source metadata
- implement source-scoped failure handling

Excluded work:
- final retrieval strategy integration
- final chat answer generation

Tests to add:
- NDJSON normalization tests
- PDF parsing/chunk metadata tests
- article scraping and content extraction tests
- partial failure and state commit tests

Human verification:
- run ingestion and inspect emitted counts for foundry, PDFs, and articles
- confirm new article URLs are captured and old ones skipped
- confirm a failed source ingest does not erase successful source data

### Phase 4: Retrieval Layer Integration
Goal:
- implement the approved retrieval layer and expose retrieval results with citations

Scope:
- implement the finalized hybrid retrieval layer
- build the chunk index/update/delete workflow
- implement retrieval queries over normalized content
- support source-type filters and source references
- ensure stale entries are removed when PDFs or foundry records disappear

Excluded work:
- final assistant prompt shaping and answer UX polish

Tests to add:
- retrieval relevance smoke tests
- stale-entry deletion tests
- citation metadata propagation tests
- force re-ingest rebuild tests

Human verification:
- run a retrieval-only debug command or logging mode and confirm relevant chunks are returned for sample questions
- remove a source and confirm its chunks no longer appear in retrieval results
- force a full re-ingest and confirm the index rebuilds from scratch

### Phase 5: Interactive Assistant And Citation-Aware Answers
Goal:
- connect retrieval to an interactive assistant that answers questions with references

Scope:
- integrate the selected model/provider
- implement prompt construction from retrieved evidence
- generate answers with clear references
- distinguish direct support from inference in final responses
- keep chat memory in-process only for the current run

Excluded work:
- advanced UX polish beyond terminal interaction
- long-term memory features

Tests to add:
- prompt assembly tests
- citation formatting tests
- session-memory reset tests
- end-to-end smoke tests with mocked model responses

Human verification:
- ask sample questions from the brief and confirm answers include referenced sources
- confirm the process can be ended with Ctrl+C
- restart the app and confirm prior chat history is not present

### Phase 6: Hardening, Validation, And Documentation Alignment
Goal:
- finish error handling, operational safeguards, and documentation consistency

Scope:
- harden logging and degraded-mode messaging
- validate startup behavior across unchanged, changed, removed, and force-refresh scenarios
- align README with implemented final behavior
- update `AGENTS.md` if durable process rules changed during implementation

Excluded work:
- large new feature additions outside the agreed spec

Tests to add:
- end-to-end startup scenario coverage
- degraded-mode startup tests
- documentation consistency review checklist

Human verification:
- run through unchanged startup, changed foundry export, added/removed PDFs, and forced refresh
- verify degraded-mode messaging for a simulated failing source
- review README against actual behavior and confirm terminology matches the implementation

## Testing And Validation Strategy

### Automated Test Coverage Expectations
At minimum, automated tests should cover:
- manifest-based change detection
- PDF inventory diffing
- scrape cadence and dedupe rules
- source normalization and metadata retention
- state commit and rollback behavior on failure
- retrieval deletion behavior for removed sources
- answer citation formatting

### Manual Validation Expectations
Each phase must include explicit human checks. Across the full project, manual verification must include:
- startup with no source changes
- startup with foundry export changes
- startup after PDF additions
- startup after PDF removals
- startup with new Keith Baker links discovered
- startup while scrape interval has not elapsed
- startup with `--force-reingest`
- answer generation for both retrieval-heavy and inference-heavy questions

### Acceptance Scenarios
The following scenarios are required acceptance checks for the finished system:

1. Unchanged launch:
- application reports that sources are unchanged and avoids unnecessary refresh work
- assistant still starts normally

2. Foundry update:
- changed manifest triggers foundry re-ingest
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
- `foundry-export/records.ndjson` is the canonical foundry record corpus.
- PDF identity is filename-based for incremental decisions.
- The project starts as a local CLI tool rather than a service.
- Provider credentials can be supplied via environment variables.

### Finalized Decisions
- Retrieval layer: hybrid SQLite metadata plus vector retrieval
- Provider model family: OpenAI-compatible chat and embeddings behind a compartmentalized adapter boundary
- Default runtime state location: `.eberron-query-assistant/`
- Canonical force-refresh flag: `--force-reingest`

### Defaults Chosen By This Spec
- Single authoritative spec file: `docs/specification.md`
- Startup refresh is mandatory before chat begins
- Partial source failures allow degraded startup if at least one usable corpus remains
- Session memory is in-process only and does not persist across launches

## README Alignment Requirements
When `README.md` is written or updated, it must remain consistent with this specification and present the project as a finished product. It should summarize:
- what the tool ingests
- what happens on startup
- how the interactive assistant behaves
- how to run it
- what kind of references users should expect in answers

It must not duplicate implementation phase details or internal authoring rules.
