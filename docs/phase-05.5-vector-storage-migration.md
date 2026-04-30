# Phase 05.5: Vector Storage Migration

## Goal
Replace the giant JSON vector index with durable SQLite-backed vector storage so provider-generated embeddings are checkpointed incrementally without large whole-file rewrites, memory pressure, or lost progress after aborts. Existing JSON vector artifacts are discarded and regenerated into SQLite.

## Current In-Progress State
- Commit `038b123` contains the completed Phase 05 assistant runtime plus batched, retryable, checkpointed embedding refresh.
- The working tree currently has uncommitted experimental changes in:
  - `src/retrieval/retrieval-service.ts`
  - `tests/retrieval.test.ts`
- Those uncommitted changes attempted a streaming NDJSON vector-index format. Do not continue that approach. Replace or discard those changes before implementing this phase.
- The existing runtime artifact `.eberron-query-assistant/retrieval/vector-index.json` is disposable derived data. Delete it during retrieval refresh and regenerate missing vectors into SQLite.

## Scope
- Convert vector storage from `.eberron-query-assistant/retrieval/vector-index.json` to SQLite rows keyed by `chunk_id`.
- Store embeddings in SQLite alongside the existing retrieval database unless implementation proves a separate DB is necessary.
- Do not migrate existing JSON vector entries. Regenerate embeddings through the active embedding adapter for any chunks missing compatible SQLite rows.
- Keep lexical retrieval and corpus metadata behavior unchanged.
- Keep Phase 05 user-facing commands unchanged:
  - `npm run start`
  - `npm run reingest`
  - `npm run debug:retrieval -- "<query>"`

## Out Of Scope
- Replacing the embedding provider.
- Changing chunking strategy except where needed to keep embedding inputs within provider limits.
- Reworking assistant prompt behavior.
- Phase 06 documentation alignment and full hardening work.

## Version And Compatibility
- Treat Phase 05.5 as a patch to Phase 05, not a normal minor implementation phase.
- Update the package/app version to patch version `0.5.1`.
- Runtime-state invalidation must compare only the major/minor version line, so `0.5.0` state remains compatible with `0.5.1` while old phase lines such as `0.4.x` still invalidate.
- Add a retrieval artifact schema marker separate from `appVersion`, such as a vector store schema version, so future vector-storage changes do not require clearing all runtime state.

## Target Storage Design
- Add a vector table to the SQLite retrieval database, for example:
  - `chunk_id TEXT PRIMARY KEY`
  - `content_hash TEXT NOT NULL`
  - `embedding_model_id TEXT NOT NULL`
  - `embedding_schema_version TEXT NOT NULL`
  - `embedding_json TEXT NOT NULL` or `embedding_blob BLOB NOT NULL`
  - `updated_at TEXT NOT NULL`
- Store one embedding per chunk row.
- Reuse rows only when `chunk_id`, `content_hash`, `embedding_model_id`, and `embedding_schema_version` all match.
- Delete stale vector rows for chunks that no longer exist.
- Upsert each successful embedding batch in a SQLite transaction.
- Search should load compatible vectors from SQLite for the current query instead of loading a giant JSON file.

## Legacy JSON Disposal Requirements
- On startup, initialize the vector table before vector sync.
- Delete existing `.eberron-query-assistant/retrieval/vector-index.json` during retrieval refresh.
- Do not read, parse, validate, migrate, rename, or back up the legacy JSON artifact.
- Existing compatible SQLite vector rows remain reusable.
- Chunks without compatible SQLite vector rows must be regenerated through the active embedding adapter.

## Required Tests
- Deletes legacy `vector-index.json` during refresh and regenerates missing embeddings into SQLite.
- Continues embedding generation only for chunks missing compatible SQLite rows.
- Deletes stale vector rows when chunks are removed.
- Upserts vector rows after each successful provider batch so aborting does not lose completed batch progress.
- Keeps search behavior working across lexical, vector, and hybrid results.
- Handles an oversized chunk input without provider `8192 tokens` errors by bounding embedding input.
- Does not load, parse, or stringify the legacy vector index during normal refresh.
- Existing retrieval, runtime, provider, config, lint, and build checks continue to pass.

## Project State At End Of Phase
At the end of this phase, retrieval vector persistence is SQLite-backed, resumable, and safe for the current corpus size. Existing generated embeddings from the JSON checkpoint have been discarded, missing embeddings have been regenerated into SQLite, and future startup refreshes no longer read or write a massive vector JSON artifact.

## Human Verification
- Start from the current runtime directory containing `vector-index.json`.
- Run `npm run start`.
- Confirm startup deletes `vector-index.json`.
- Confirm missing embeddings are regenerated into SQLite.
- Stop during embedding generation with `Ctrl+C`, then run `npm run start` again and confirm completed batches are reused.
- Run `npm run debug:retrieval -- "aerenal deathless"` and confirm cited retrieval results still appear.
- Confirm no new massive `vector-index.json` read or rewrite happens during normal refresh.

## Assumptions And Prerequisites
- Phase 05 is otherwise complete and committed at `038b123`.
- The existing JSON vector checkpoint may contain paid provider-generated embeddings, but preserving or migrating it is no longer worth the implementation cost.
- SQLite remains the authoritative corpus metadata store and is acceptable for vector persistence.
- Binary vector storage can be considered later, but SQLite rows are the preferred durable fix for Phase 05.5.
