# Phase 04: Retrieval Layer

## Goal
Implement the finalized retrieval layer so normalized sources become queryable with citation-friendly results and reliable stale-entry cleanup.

## Scope
- Build the hybrid retrieval layer defined in [`specification.md`](./specification.md):
  - SQLite as the authoritative metadata and chunk store
  - lexical lookup support for exact-term and filter-driven retrieval
  - vector index keyed by chunk identifier for semantic recall
- Implement chunk indexing, update, deletion, and rebuild workflows.
- Support source-type and source-identity filtering.
- Ensure removed PDFs, changed foundry exports, and deleted source records are removed from retrieval results.
- Expose retrieval results in a form the assistant runtime can use directly, including provenance and citation fields.

## Out Of Scope
- Final provider-backed chat loop
- Final prompt orchestration and answer formatting polish
- Cross-session memory features

## Required Tests
- Retrieval smoke tests over mixed source types
- Citation metadata propagation tests
- Stale-entry deletion tests
- Full rebuild tests for `--force-reingest`
- Recovery tests proving the vector index can be rebuilt from authoritative stored corpus records

## Project State At End Of Phase
At the end of this phase, the application maintains a working retrieval corpus that can return relevant chunks with provenance and can remove stale data when sources disappear or change. The retrieval stack is ready to be connected to an interactive assistant.

## Human Verification
- Run the application in a retrieval-debug or otherwise inspectable mode and confirm relevant chunks are returned for sample questions.
- Remove a source and confirm its records no longer appear in retrieval results.
- Force a full re-ingest and confirm retrieval artifacts are rebuilt cleanly.
- Confirm returned records include enough metadata to cite their source.

## Assumptions And Prerequisites
- Phase 03 has already populated normalized source and chunk records.
- SQLite remains the authoritative persistence layer for corpus metadata.
- The vector index is a derived accelerator and must be safe to rebuild.
