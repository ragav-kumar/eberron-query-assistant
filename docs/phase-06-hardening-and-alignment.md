# Phase 06: Hardening And Alignment

## Goal
Finish the project by tightening startup safety, degraded-mode reporting, end-to-end scenario coverage, and documentation consistency.

## Scope
- Bump the application version to `0.6.0`.
- Preserve usable Phase 5.5 runtime and retrieval state across the Phase 6 version bump.
- Harden startup refresh so runtime state is committed only after ingestion and retrieval refresh complete successfully enough to trust.
- Make degraded startup output explicit by naming failed source types and distinguishing discovery failures, ingestion failures, and partial source failures.
- Preserve source-scoped behavior so one failed source does not block other source checks or successful source ingestion.
- Validate unchanged, changed, removed, forced-refresh, degraded, and empty-corpus startup scenarios.
- Align `README.md`, `AGENTS.md`, and `docs/specification.md` with the implemented final behavior.

## Out Of Scope
- New ingestion sources or assistant features outside the approved final-state specification.
- New provider behavior or model selection changes.
- GUI work.
- Broad architecture rewrites unless required to correct a final-state specification mismatch.

## Required Tests
- Version test for Phase 6 `0.6.0`.
- State-store tests proving version differences alone do not invalidate persisted runtime state.
- Runtime tests proving state is not saved when retrieval refresh fails or when startup produces an empty corpus.
- Runtime tests proving degraded startup output names degraded source types.
- Ingestion tests proving per-source failures do not commit untrusted inventory state or erase unrelated successful corpus data.
- Article failure tests proving failed article page ingestion does not advance the weekly scrape cadence.
- Existing retrieval tests proving SQLite vector storage, stale-row cleanup, checkpointed embedding batches, and hybrid search still work.

## Project State At End Of Phase
At the end of this phase, the repository is aligned around the finished system. Startup behavior is validated across expected operational scenarios, degraded-mode behavior is explicit, runtime state is not advanced ahead of usable retrieval artifacts, and the documentation set accurately describes both durable rules and final product behavior.

## Human Verification
- Run unchanged startup and confirm sources are skipped where expected.
- Change the Foundry manifest and confirm Foundry refresh is scheduled.
- Add and remove PDFs and confirm PDF inventory changes are reported.
- Run `npm run reingest` and confirm full refresh output is explicit.
- Run `npm run debug:retrieval -- "aerenal deathless"` and confirm retrieval results print without entering chat.
- Simulate a failing source pipeline and confirm degraded-mode messaging names the affected source type.
- Confirm an empty corpus fails before entering chat.
- Confirm the docs set consists of `AGENTS.md`, `docs/specification.md`, `docs/phase-*.md`, and `README.md`, with no active `docs/brief.md`.

## Assumptions And Prerequisites
- Earlier phases and Phase 5.5 are complete enough to support end-to-end scenario validation.
- Phase 6 should not add new product features beyond the approved final-state specification.
- Documentation updates in this phase should reflect the implemented system, not future ideas or backlog items.
