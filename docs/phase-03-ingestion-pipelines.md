# Phase 03: Ingestion Pipelines

## Goal
Convert each supported source type into normalized source and chunk records with durable metadata and source-scoped failure handling.

## Scope
- Increment the application version to `0.3.0` and introduce app-version-based runtime state invalidation.
- Parse `foundry-export/records.ndjson` and normalize foundry entities into source and chunk records.
- Parse PDFs into chunked text with page-level metadata where supported by the parser.
- Scrape newly discovered Keith Baker article pages and normalize their content.
- Persist normalized sources and chunks in SQLite as the authoritative corpus storage model defined by the final-state spec.
- Implement source-scoped write behavior so failed ingests do not incorrectly mark incomplete work as current.
- Preserve citation metadata for foundry, PDF, and article sources.

## Out Of Scope
- Final hybrid retrieval integration
- Final answer generation and provider-backed chat responses
- UX polish beyond ingestion progress and error reporting

## Required Tests
- App-version state invalidation tests
- NDJSON normalization tests
- PDF parsing and page-metadata tests
- Article scraping and extraction tests
- Source-scoped failure handling and partial-commit tests
- Metadata retention tests for citation fields

## Project State At End Of Phase
At the end of this phase, the application is versioned as `0.3.0`, invalidates runtime state from any other app version, ingests all supported source classes, and persists normalized corpus data with enough metadata to support later retrieval and citation. Startup decisions from Phase 02 now drive real ingestion work instead of only reporting what would happen.

## Human Verification
- Run ingestion and confirm counts are emitted for foundry records, PDFs, and articles.
- Confirm old or missing `appVersion` in runtime state is reported as invalidated and rebuilt from current inputs.
- Confirm a newly discovered article is fetched and normalized while previously captured articles are skipped.
- Confirm a failed source ingest does not erase or overwrite previously successful data for unrelated source types.
- Inspect persisted runtime artifacts and verify that source and chunk metadata are present and identifiable.

## Assumptions And Prerequisites
- Phase 02 state and discovery logic is complete and stable.
- Network access is only required for article scraping; most parsing logic should remain testable offline.
- The authoritative storage model may be introduced incrementally here, but it must align with the final-state spec so later retrieval work does not require redesign.
- Runtime state from earlier phases may be discarded during verification because `appVersion` invalidation replaces schema-version migrations.
