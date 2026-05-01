# Phase 7 Enhancements

## Table Of Contents
- [Force-Reingest-Only Invalidation](#force-reingest-only-invalidation)
- [Assistant Prompt Assets And Local Context](#assistant-prompt-assets-and-local-context)

## Force-Reingest-Only Invalidation

### Goal
Remove automatic invalidation as a startup behavior. Existing runtime state, corpus rows, and retrieval artifacts must not be discarded, cleared, or force-rebuilt because of application version metadata.

### Scope
- Treat `appVersion` as diagnostic metadata only.
- Preserve valid runtime state even when `appVersion` is old, non-semver, or missing.
- Clear corpus storage and force retrieval rebuild only when `--force-reingest` or `npm run reingest` is used.
- Fail clearly on incompatible corpus SQLite artifacts during routine startup and instruct the user to run `npm run reingest`.

### Out Of Scope
- Changing source discovery cadence or source-specific incremental refresh behavior.
- Editing frozen Phase 1 through Phase 6 historical documents.
- Adding new source types or assistant prompt features.

### Expected End State
Routine startup validates persisted state by shape, keeps usable source and retrieval artifacts in place, and performs only incremental source-scoped updates. Explicit force re-ingest remains the single supported path for intentional corpus clearing and retrieval rebuild.

### Required Tests
- State-store coverage for valid state with old, non-semver, and missing `appVersion`.
- Runtime coverage proving retrieval `forceRebuild` follows only `forceReingest`.
- Ingestion coverage proving corpus clearing follows only `forceReingest`.
- Corpus-store coverage proving incompatible SQLite artifacts fail without explicit reset and are recreated only when reset is allowed.

### Human Verification
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.
- Run startup with immediate `exit` input and confirm no runtime-state invalidation message appears.
- Run `npm run reingest` when a full explicit rebuild is desired.

### Assumptions
- Malformed runtime state remains a validation error.
- Incompatible persisted artifacts should fail loudly instead of being silently trusted or silently rebuilt.

## Assistant Prompt Assets And Local Context

### Goal
Provide a repo-local place for assistant prompt assets and a local-only Markdown file for additional assistant context that cannot come from Foundry, PDFs, or articles.

### Scope
- Store tracked prompt assets in `assistant/system-prompt.md` and `assistant/session-title-prompt.md`.
- Keep `assistant/additional-context.md` gitignored and create it as an empty file at runtime when missing.
- Include non-empty additional context in every assistant request as prompt context, not as a retrieval source.
- Preserve current citation, retrieval evidence, in-memory history, and session transcript behavior.

### Out Of Scope
- Adding new retrieval source types.
- Persisting session logs as future assistant memory.
- Changing the answer format beyond externalizing the existing prompt text.

### Expected End State
The assistant loads prompt instructions from tracked Markdown files and includes local-only additional context when the user has written any. Local edits to `assistant/additional-context.md` do not appear in git status.

### Required Tests
- Config coverage for assistant prompt paths.
- Prompt coverage for file-backed system instructions and session-title instructions.
- Prompt coverage for non-empty and empty additional context.
- Prompt coverage proving missing local context is created empty.

### Human Verification
- Run `npm test`.
- Run `npm run lint`.
- Run `npm run build`.
- Run startup with immediate `exit` input and confirm `assistant/additional-context.md` exists.
- Edit `assistant/additional-context.md` locally and confirm `git status --short` does not report it.

### Assumptions
- Local context belongs in the prompt for every assistant request.
- The context file is intentionally personal/local and should not be tracked by git.
