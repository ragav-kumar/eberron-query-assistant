# Phase 7: Force-Reingest-Only Invalidation

## Goal
Remove automatic invalidation as a startup behavior. Existing runtime state, corpus rows, and retrieval artifacts must not be discarded, cleared, or force-rebuilt because of application version metadata.

## Scope
- Treat `appVersion` as diagnostic metadata only.
- Preserve valid runtime state even when `appVersion` is old, non-semver, or missing.
- Clear corpus storage and force retrieval rebuild only when `--force-reingest` or `npm run reingest` is used.
- Fail clearly on incompatible corpus SQLite artifacts during routine startup and instruct the user to run `npm run reingest`.

## Out Of Scope
- Changing source discovery cadence or source-specific incremental refresh behavior.
- Editing frozen Phase 1 through Phase 6 historical documents.
- Adding new source types or assistant prompt features.

## Expected End State
Routine startup validates persisted state by shape, keeps usable source and retrieval artifacts in place, and performs only incremental source-scoped updates. Explicit force re-ingest remains the single supported path for intentional corpus clearing and retrieval rebuild.

## Required Tests
- State-store coverage for valid state with old, non-semver, and missing `appVersion`.
- Runtime coverage proving retrieval `forceRebuild` follows only `forceReingest`.
- Ingestion coverage proving corpus clearing follows only `forceReingest`.
- Corpus-store coverage proving incompatible SQLite artifacts fail without explicit reset and are recreated only when reset is allowed.

## Human Verification
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.
- Run startup with immediate `exit` input and confirm no runtime-state invalidation message appears.
- Run `npm run reingest` when a full explicit rebuild is desired.

## Assumptions
- Malformed runtime state remains a validation error.
- Incompatible persisted artifacts should fail loudly instead of being silently trusted or silently rebuilt.
