# Phase 05.5: Vector Storage Migration

## Goal
Replace the giant JSON vector index with durable SQLite-backed vector storage so provider-generated embeddings are checkpointed incrementally without large whole-file rewrites, memory pressure, or lost progress after aborts.

## Current In-Progress State
- Commit `038b123` contains the completed Phase 05 assistant runtime plus batched, retryable, checkpointed embedding refresh.
- The working tree currently has uncommitted experimental changes in:
  - `src/retrieval/retrieval-service.ts`
  - `tests/retrieval.test.ts`
- Those uncommitted changes attempted a streaming NDJSON vector-index format. Do not continue that approach. Replace or discard those changes before implementing this phase.
- The existing runtime artifact `.eberron-query-assistant/retrieval/vector-index.json` may contain valuable OpenAI embeddings already generated during interrupted startup runs. Do not delete it during this phase.

## Scope
- Convert vector storage from `.eberron-query-assistant/retrieval/vector-index.json` to SQLite rows keyed by `chunk_id`.
- Store embeddings in SQLite alongside the existing retrieval database unless implementation proves a separate DB is necessary.
- Preserve already-generated embeddings by migrating compatible entries from the current JSON checkpoint into SQLite before generating missing embeddings.
- Continue provider-backed embedding refresh from the migrated checkpoint rather than starting from zero.
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

## Migration Requirements
- On startup, initialize the vector table before vector sync.
- If the vector table is empty or missing compatible rows, attempt one-time import from existing `.eberron-query-assistant/retrieval/vector-index.json`.
- The importer must support the current JSON format produced by Phase 05.
- Import must be streaming or otherwise memory-safe enough for the existing large checkpoint.
- Imported rows must preserve their original `chunk_id`, `content_hash`, model id, schema version, and embedding vector.
- After successful import, leave the JSON file in place or rename it to a backup name; do not delete it automatically in the same run.
- If import fails, report a clear warning and continue by generating only missing embeddings when possible.

## Required Tests
- Migrates compatible JSON vector entries into SQLite and reuses them without provider calls.
- Continues embedding generation only for missing chunks after migration.
- Deletes stale vector rows when chunks are removed.
- Upserts vector rows after each successful provider batch so aborting does not lose completed batch progress.
- Keeps search behavior working across lexical, vector, and hybrid results.
- Handles an oversized chunk input without provider `8192 tokens` errors by bounding embedding input.
- Does not load or stringify the full vector index as one giant JSON string during normal refresh.
- Existing retrieval, runtime, provider, config, lint, and build checks continue to pass.

## Project State At End Of Phase
At the end of this phase, retrieval vector persistence is SQLite-backed, resumable, and safe for the current corpus size. Existing generated embeddings from the JSON checkpoint have been migrated or safely skipped with clear warnings, and future startup refreshes no longer rewrite a massive vector JSON artifact.

## Human Verification
- Start from the current runtime directory containing `vector-index.json`.
- Run `npm run start`.
- Confirm startup reports that vector embeddings were imported or reused from existing storage.
- Confirm progress continues from the prior checkpoint rather than regenerating all embeddings.
- Stop during embedding generation with `Ctrl+C`, then run `npm run start` again and confirm completed batches are reused.
- Run `npm run debug:retrieval -- "aerenal deathless"` and confirm cited retrieval results still appear.
- Confirm no new massive `vector-index.json` rewrite happens during normal refresh.

## Assumptions And Prerequisites
- Phase 05 is otherwise complete and committed at `038b123`.
- The existing JSON vector checkpoint may be large but is worth preserving because it contains paid provider-generated embeddings.
- SQLite remains the authoritative corpus metadata store and is acceptable for vector persistence.
- Binary vector storage can be considered later, but SQLite rows are the preferred durable fix for Phase 05.5.
