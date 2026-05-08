# Delta Foundry Export Ingestion

## Purpose

Replace the old Foundry ingestion contract of `foundry-export/manifest.json` plus `foundry-export/records.ndjson` with the new timestamped delta NDJSON export files. This document is an agent-facing specification for later implementation planning; it intentionally stays high level.

No backwards compatibility is required. Existing local retrieval state can be rebuilt through force reingest after this enhancement is implemented.

## Export Contract

`foundry-export/` is the complete local history of Foundry export output. Export files are named like `${compactUtcTimestamp}-foundry-export.ndjson`, and filenames are expected to sort chronologically.

Each export file is NDJSON:

- Line 1 is a manifest envelope: `{ "kind": "manifest", "manifest": ... }`.
- Manifest schema version must be `2.0.0`.
- Remaining lines are operation envelopes with `kind: "upsert"` or `kind: "delete"`.
- `manifest.run.upsertCount` and `manifest.run.deleteCount` are integrity checks for the operation lines.
- `manifest.run.recordCount` is the total Foundry corpus size after the export run, not the file line count.

The old separate manifest file, `records.ndjson`, sync-state object, `entries` collection, and file map are obsolete.

## Intended Ingestion Behavior

Source discovery should scan `foundry-export/` for timestamped export files, compare them against persisted Foundry ingestion state, and schedule only unapplied files during routine refresh. When multiple files are unapplied, apply them oldest to newest.

Force reingest may clear app-owned corpus and retrieval artifacts, then replay the export history needed to reconstruct the current Foundry corpus. Routine refresh must not replace all Foundry rows wholesale; it should apply only unapplied delta files and preserve unrelated existing Foundry corpus rows.

Upsert operations should normalize `entry.record` through the existing Foundry normalized-record path and replace the corpus source keyed by `record.recordId`. Delete operations should remove the Foundry corpus source, chunks, and derived retrieval entries associated with `record.recordId`.

Persist Foundry ingestion progress only after all scheduled export files have been applied successfully. Failed or partially applied export batches must not be marked current.

## Development Phases

1. **Discovery and State**
   - Replace `manifest.json` discovery with timestamped NDJSON export discovery.
   - Persist the last successfully applied Foundry export file/run marker.
   - Schedule Foundry ingestion when force reingest is requested or unapplied export files exist.

2. **Delta Parsing and Application**
   - Parse manifest, upsert, and delete envelopes with clear validation errors.
   - Enforce manifest schema and operation count checks.
   - Apply upserts and deletes source-by-source without clearing all Foundry data during routine refresh.
   - Update Foundry state only after successful application.

3. **User-Facing Alignment**
   - Update active enhancement documentation and README text so they describe timestamped Foundry NDJSON exports instead of the old two-file export shape.
   - Keep frozen historical baseline documents unchanged.

## Test Coverage

Cover discovery for missing export directories, empty export directories, one new export file, multiple unapplied files, already-applied exports, and force reingest.

Cover ingestion for valid manifests, upserts, deletes, mixed operation files, chronological multi-file replay, invalid JSON, wrong first-line kind, unsupported schema version, and manifest count mismatches.

Cover state safety by proving routine refresh skips already-applied files, applies only new files, preserves untouched Foundry corpus rows, and does not advance persisted Foundry state after failed ingestion.

Verification should include `npm run prestart`, targeted Vitest coverage for source discovery, ingestion, state, and retrieval behavior, and a startup smoke check that confirms delta Foundry refresh output without leaving the app hanging.

