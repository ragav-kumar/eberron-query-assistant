# V1 Legacy Reference

## Purpose

This document preserves the small amount of V1 knowledge that still matters during the V1-to-V2 transition.

Its purpose is compatibility and cleanup guidance only. It is not an invitation to use V1 implementation code as an architectural reference for V2 work.

## Preserved V1 Artefacts

The following V1 artefacts are intentionally preserved for now:

- `docs/fdd-v1.md` as historical product-behavior documentation for V1
- `docs/known-v1-bugs.md` as a record of V1 pitfalls that should not be reintroduced
- V1 user data on disk that may still need to be migrated into V2
- the V1-to-V2 migration entrypoint under `src/server/migrate-v1-to-v2.ts`
- only the minimum legacy parsing or config logic still needed to support re-migration

## Artefacts Intended For Removal

The following V1 artefacts are harmful when left in place as routine references or live product surfaces and should be removed during cleanup once their remaining compatibility role is eliminated:

- the live V1 client bootstrap path
- the live `/api/v1/*` server runtime path
- obsolete V1 assistant prompt assets under `assistant/` that have already been adapted into `src/server/v2/prompts`
- broad V1 runtime or UI code kept only for convenience rather than for migration compatibility

The V1 prompt files are not part of the preserved reference set. Their useful behavior has already been absorbed into the V2 prompt assets and should not be treated as active source material.

## Legacy Disk Inputs That Must Remain Re-Migratable

V1 user data must remain eligible for migration into V2. The current migration path understands these legacy inputs:

- `.eberron-query-assistant/state/runtime-state.json`
- `.eberron-query-assistant/state/generated-npcs.json`
- JSON log files under `logs/`
- the older `logs/generated_npcs.md` fallback that may still be converted into generated NPC state before migration
- `assistant/additional-context.md` as legacy singleton state that is migrated into V2 settings
- repo-local source and runtime directories discovered from the repo root, including `foundry-export/`, `pdf/`, `.eberron-query-assistant/`, `logs/`, and cache/retrieval subdirectories

## Legacy Data Shapes Still Understood By Migration

### Runtime State

The migration script currently reads V1 runtime state from `.eberron-query-assistant/state/runtime-state.json` with three source-oriented sections:

- `article`
  - `knownArticles[]` entries with canonical URL, first-seen time, last-ingested time, scrape status, and optional title
  - `lastSuccessfulIndexScrapeAt`
- `foundry`
  - `appliedExportFilenames[]`
  - `lastSuccessfulExport` metadata including filename, generated time, run id, schema version, record count, upsert count, and delete count
- `pdf`
  - `knownFilenames[]`

This data is migrated into V2 settings plus V2 `ingestedFiles` and `ingestedArticles` records.

### Generated NPC State

The migration script currently reads generated NPC state from `.eberron-query-assistant/state/generated-npcs.json` as an array of records containing:

- `id`
- `name`
- `description`
- `bio`
- `createdAt`
- `updatedAt`
- optional `species`, `ethnicity`, `gender`, `role`, and `age`

This data is imported into a legacy V2 NPC session and run.

### Legacy NPC Markdown Fallback

The repo still contains logic that can recover generated NPC records from the older `logs/generated_npcs.md` format when the JSON NPC state file is absent.

That fallback is part of re-migration compatibility, not a product behavior to preserve in V2.

### Legacy Log Files

The migration script currently reads legacy transcript data from JSON files under `logs/`.

The current migration logic expects:

- a top-level JSON array
- `progress` entries with a non-empty `message`
- `exchange` entries with non-empty `user` and `assistant`
- older exchange entries with no explicit `kind`, as long as `user` and `assistant` are still present

Legacy log filenames may also carry session metadata through the `YYYYMMDDHHMMSS Title` naming pattern. When that pattern is present, the migration logic derives the V2 session creation time and session title from the filename.

## What Future V2 Work Should Use Instead

For ordinary V2 work, prefer these sources instead of V1 code:

- `docs/fdd-v2.md` for V2-specific product behavior
- `docs/fdd-v1.md` only when historical V1 behavior needs to be understood at the product level
- `src/server/v2/prompts/` for active assistant and NPC prompt behavior
- this document for legacy compatibility boundaries

Raw V1 implementation files are a migration aid, not a normal design reference.
