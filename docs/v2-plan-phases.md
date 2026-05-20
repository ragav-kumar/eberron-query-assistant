# V2 Plan

High-level roadmap for the remaining V2 work. This document is intentionally short and should stay grounded in the current codebase rather than aspirational architecture.

## Working Rules For Future Sessions

- Prefer server-side work. Most agent implementation work should stay within `src/server/v2` and related tests.
- Before taking on client-side V2 work, first explain what is ready to be implemented and give the user a chance to handle that client work personally.
- Do not change DTOs, API contracts, or database schemas without explicit user approval.
- Keep the V2 architecture aligned with the intentional Node-server-backed application shape; do not plan around a browser-only shortcut.
- Keep the top-level folder structure within `src/server/v2` tight and domain-oriented. A little depth is acceptable when it keeps domain ownership clear.
- If a proposed change materially expands work outside `src/server/v2` and tests, get approval first unless the user explicitly requested that broader scope.

## Baseline prior to phase 1

- Refresh orchestration is implemented, including `POST /api/v2/refresh`, startup refresh, console SSE, and runtime SSE plumbing.
- Read-side V2 endpoints already exist for session summaries, session feeds, NPC listing, additional context, and refresh state.
- The V2 app database already has durable tables for sessions, runs, session entries, NPCs, settings, and refresh state.
- `POST /api/v2/runs` is still a stub through `runCoordinator`, and `createV2App` still wires that stubbed coordinator.
- Runtime event infrastructure exists, but refresh is the only fully wired event source today.
- NPC server-side filtering and pagination already exist; the missing work is mainly around using them properly in the V2 workflow and UI.

## Phase Completion Rule

- When a phase is completed, update this document in the same session.
- Mark the phase complete.
- Add a short `Repo state after completion:` note with 2-4 bullets describing what is now true in the repo.
- Adjust later phases if the completed work changes the most sensible order or narrows the remaining scope.

## Phase 1: Run Execution Foundation

- Replace the stubbed `runCoordinator` with a real V2 run entrypoint.
- Make `POST /api/v2/runs` able to continue an existing persisted session and persist run/session-entry data for completed runs.
- Enforce run blocking while refresh or reingest is active.
- Update session metadata correctly, including generated titles and `activeRunId`.
- Keep the implementation on V2 persistence paths only; reuse V1 runtime pieces selectively, not V1 persistence patterns.
- Human testable:
  - Submit a prompt against an existing persisted session.
  - Reload and confirm the resulting feed is still present.

## Phase 2: Runtime Event Completion

- Publish real run lifecycle events from server execution paths.
- Publish session-entry append events and session promotion/update events in the DTO shapes the client already expects.
- Wire `createV2App` to build the real coordinator with the runtime dependencies it needs.
- Ensure the existing V2 runtime subscription is operating against real events rather than refresh-only behavior.
- Human testable:
  - Start a run with the UI open and verify the session/feed updates without a manual reload.

## Phase 3: Assistant Session Workflow

- Finish assistant submit wiring so the input actually drives the V2 run flow.
- Implement UI-local new-session behavior and first-run promotion into a persisted titled session.
- Lock `Include party context` after the first persisted prompt in a session.
- Render assistant in-flight behavior in the intended shape, including visible thinking state and intermediate reasoning entries.
- Keep the assistant feed behavior aligned with the persisted session/run model rather than ad hoc client-only state.
- Human testable:
  - Create a new assistant session.
  - Submit the first prompt and watch it promote into a titled saved session.
  - Submit a later prompt and confirm party-context locking is enforced.

## Phase 4: NPC Workflow Completion

- Finish the shared run path for NPC mode, including NPC persistence/finalization behavior.
- Replace placeholder NPC-session workflow behavior with the real V2 session/run flow.
- Surface the existing server-side NPC filter/pagination support in the client.
- Keep NPC cards rendered across sessions while clearly marking cards that belong to the active session.
- Human testable:
  - Generate NPCs in one session.
  - Confirm cards persist after reload.
  - Filter or page through the list and verify active-session cards are visibly distinguished.

## Phase 5: V2 Readiness Pass

- Reconcile the remaining client/server mismatches uncovered during the earlier phases.
- Remove stale assumptions from this roadmap so it reflects the actual end state before final cleanup begins.
- Confirm the normal V2 assistant and NPC workflows are complete enough that V1 removal can be treated as a separate follow-up phase rather than a live dependency.
- Keep any remaining V1 reuse narrowly limited to transition-era support that will be removed in Phase 6.
- Human testable:
  - The main V2 assistant and NPC workflows run as a coherent product slice with no known placeholder path for normal use.
  - There is no remaining normal-user workflow that still requires V1 to stay in place before Phase 6 starts.

## Phase 6: Final Cleanup And V1 Purge

- Only begin this phase once the normal V2 assistant and NPC workflows are fully working end to end.
- Update `docs/fdd-v2.md` if final implementation reality or settled product behavior needs to be captured there.
- Purge the remaining V1 application code and obsolete transition-era wiring after V2 is confirmed ready to stand alone.
- Leave the repo in a V2-only product state, while allowing temporary agent-governance cleanup work to happen afterward in a separate phase.
- Human testable:
  - V2 still runs correctly after V1 removal, and there is no remaining normal-user path that depends on V1 behavior or assets.

## Phase 7: Agent-Governance Cleanup

- Treat this phase as separate follow-up work because it may require `Introspection` mode.
- Remove this temporary planning document once it is no longer needed.
- Clean up `AGENTS.md`, `docs/agent-modes.md`, and any other transition-era agent instructions that only existed to support the V1 to V2 migration.
- Leave the remaining agent-governance docs aligned with the repo's post-migration steady state.
- Human testable:
  - Not applicable beyond confirming the product still works after the prior phase; this phase is primarily documentation and workflow cleanup.
