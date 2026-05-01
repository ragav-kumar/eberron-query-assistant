# Phase 04: Retrieval Layer

> Historical baseline: this phase document records completed Phase 4 planning. Further changes are enhancements on top of the Phase 6 baseline and must be documented elsewhere. Do not modify this document again.

## Goal
Implement the finalized retrieval layer so normalized sources become queryable with citation-friendly results and reliable stale-entry cleanup.

## Scope
- Increment the application version to `0.4.0` and verify app-version mismatch handling for retrieval artifacts.
- Build the hybrid retrieval layer defined in [`specification.md`](./specification.md):
  - SQLite as the authoritative metadata and chunk store
  - lexical lookup support for exact-term and filter-driven retrieval
  - vector index keyed by chunk identifier for semantic recall
- Implement chunk indexing, update, deletion, and rebuild workflows.
- Treat app-owned retrieval artifacts as including `.eberron-query-assistant/retrieval/corpus.sqlite`, SQLite FTS tables, vector index files, and derived retrieval metadata.
- On app-version invalidation, delete/recreate or otherwise fully rebuild SQLite and FTS retrieval storage so stale schemas cannot survive `CREATE TABLE IF NOT EXISTS`.
- Keep SQLite and FTS rebuilds local; rebuilding those artifacts must not require provider API calls.
- Make vector rebuilds cache-aware. Compatible existing embeddings may be reused only when chunk identity, content hash, embedding model, and embedding schema are still valid.
- Make progress output distinguish local retrieval artifact rebuilds from provider-backed embedding generation. If an API-backed embedding adapter is used, logs must make token-spending regeneration explicit.
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
- Version-mismatch startup tests proving the SQLite corpus store is cleared or recreated before ingestion and indexing resume
- Stale-schema protection tests using an older or incompatible SQLite artifact and confirming startup rebuilds it cleanly
- Full rebuild tests proving `npm run reingest` rebuilds SQLite-backed retrieval state, FTS data, and vector artifacts
- Recovery tests proving the vector index can be rebuilt from authoritative stored corpus records
- Embedding-cache tests proving compatible embeddings are reused and incompatible embeddings are regenerated
- Provider-adapter tests proving SQLite and FTS rebuilds do not call the embedding provider

## Project State At End Of Phase
At the end of this phase, the application maintains a working retrieval corpus that can return relevant chunks with provenance and can remove stale data when sources disappear or change. The retrieval stack is ready to be connected to an interactive assistant.

## Human Verification
- Run `npm run debug:retrieval -- "<query>"` and confirm relevant chunks are returned for sample questions.
- Remove a source and confirm its records no longer appear in retrieval results.
- Start from an existing `0.3.0` runtime directory and confirm startup reports runtime and retrieval artifact invalidation.
- Inspect `.eberron-query-assistant/retrieval/` after version invalidation and confirm `corpus.sqlite`, FTS data, and retrieval artifacts were rebuilt.
- Run `npm run reingest` and confirm SQLite-backed retrieval state, FTS data, and vector artifacts are rebuilt cleanly.
- Confirm logs identify whether embeddings were reused or regenerated.
- Confirm returned records include enough metadata to cite their source.

## Assumptions And Prerequisites
- Phase 03 has already populated normalized source and chunk records.
- SQLite remains the authoritative persistence layer for corpus metadata.
- The vector index is a derived accelerator and must be safe to rebuild.
- Rebuilding SQLite and FTS is local CPU and disk work, not provider-token-spending work.
- Embedding and vector regeneration may spend provider tokens only when the selected embedding adapter is API-backed.
- Paid embedding calls should be explicit, logged, and avoided when compatible cached embeddings are safe to reuse.
