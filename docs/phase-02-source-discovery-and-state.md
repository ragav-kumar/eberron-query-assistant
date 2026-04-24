# Phase 02: Source Discovery And State

## Goal
Implement deterministic source inventory checks and persisted runtime state so the application can decide what work to skip or schedule on startup.

## Scope
- Implement persisted runtime state storage under the repo-local runtime directory defined by the final-state spec.
- Read and trust `foundry-export/manifest.json` as the source of foundry export identity.
- Detect whether the foundry export changed using persisted export markers.
- Discover PDFs by filename and compute additions and removals.
- Track Keith Baker scrape cadence and determine whether the index should be revisited.
- Produce source inventory summaries and skip/refresh decisions for startup reporting.

## Out Of Scope
- Parsing `records.ndjson` into normalized corpus records
- Parsing PDF contents
- Scraping and ingesting article bodies
- Building retrieval artifacts
- Running assistant queries

## Required Tests
- Foundry manifest marker tests
- Persisted state load/save tests
- PDF add/remove detection tests
- Weekly scrape skip logic tests
- Startup decision tests for unchanged versus changed inventories

## Project State At End Of Phase
At the end of this phase, the application can examine all configured source classes during startup, compare them against persisted state, and report what would be processed or skipped. The runtime has a durable, versioned state model even though later phases still need to perform real ingestion.

## Human Verification
- Run the tool twice without changing any inputs and confirm skip messaging appears on the second run.
- Add a new PDF filename and confirm it is reported as newly discovered.
- Remove a PDF and confirm it is reported as removed.
- Simulate or set an old article-scrape timestamp and confirm the index scrape is scheduled.
- Confirm a recent scrape timestamp causes the article index step to be skipped.

## Assumptions And Prerequisites
- Phase 01 has already established the CLI and test harness.
- The application continues to trust the foundry manifest format and contents.
- PDF filenames are the identity key for incremental decisions.
