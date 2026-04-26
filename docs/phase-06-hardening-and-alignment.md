# Phase 06: Hardening And Alignment

## Goal
Finish operational safeguards, degraded-mode behavior, scenario validation, and documentation consistency for the completed system.

## Scope
- Harden startup logging, error messaging, and degraded-mode reporting.
- Validate behavior across unchanged, changed, removed, and forced-refresh source scenarios.
- Review and refine operational safeguards around state updates, index rebuilds, and partial failures.
- Align `README.md`, `AGENTS.md`, and `docs/specification.md` with the implemented final behavior.
- Remove stale planning artifacts that are no longer part of the approved documentation set.

## Out Of Scope
- New feature additions outside the approved final-state spec
- Broad architectural rewrites unless required to correct a mismatch with the final-state spec

## Required Tests
- End-to-end startup scenario coverage
- Degraded-mode startup tests
- Failure-path tests for per-source ingest errors
- Documentation consistency review against final implemented behavior

## Project State At End Of Phase
At the end of this phase, the repository is aligned around the finished system. Startup behavior is validated across expected operational scenarios, degraded-mode behavior is explicit, and the documentation set accurately describes both the durable rules and the final product.

## Human Verification
- Run through unchanged startup, changed foundry export, added PDF, removed PDF, and `npm run reingest` scenarios.
- Simulate a failing source pipeline and confirm degraded-mode messaging is clear.
- Review `README.md` against actual CLI behavior and confirm terminology and usage match the finished system.
- Confirm the docs set consists of `AGENTS.md`, `docs/specification.md`, `docs/phase-*.md`, and `README.md`, with no active `docs/brief.md`.

## Assumptions And Prerequisites
- Earlier phases are complete enough to support end-to-end scenario validation.
- Documentation updates in this phase should reflect the implemented system, not future ideas or backlog items.
