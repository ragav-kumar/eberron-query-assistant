# V2 Plan

High-level roadmap for the remaining V2 work. This document is intentionally short and should stay grounded in the current codebase rather than aspirational architecture.

## Working Rules For Future Sessions

- Prefer server-side work. Most agent implementation work should stay within `src/server` and related tests.
- Before taking on client-side V2 work, first explain what is ready to be implemented and give the user a chance to handle that client work personally.
- Do not change DTOs, API contracts, or database schemas without explicit user approval.
- Keep the V2 architecture aligned with the intentional Node-server-backed application shape; do not plan around a browser-only shortcut.
- Keep the top-level folder structure within `src/server` tight and domain-oriented. A little depth is acceptable when it keeps domain ownership clear.
- If a proposed change materially expands work outside `src/server` and tests, get approval first unless the user explicitly requested that broader scope.

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

## Phase 1: Run Execution Foundation — COMPLETE

- Replace the stubbed `runCoordinator` with a real V2 run entrypoint.
- Make `POST /api/v2/runs` able to continue an existing persisted session and persist run/session-entry data for completed runs.
- Enforce run blocking while refresh or reingest is active.
- Update session metadata correctly, including generated titles and `activeRunId`.
- Keep the implementation on V2 persistence paths only; reuse V1 runtime pieces selectively, not V1 persistence patterns.
- Human testable:
  - Submit a prompt against an existing persisted session.
  - Reload and confirm the resulting feed is still present.

## Phase 2: Runtime Event Completion — COMPLETE

- Publish real run lifecycle events from server execution paths.
- Publish session-entry append events and session promotion/update events in the DTO shapes the client already expects.
- Wire `createV2App` to build the real coordinator with the runtime dependencies it needs.
- Ensure the existing V2 runtime subscription is operating against real events rather than refresh-only behavior.
- Human testable:
  - Start a run with the UI open and verify the session/feed updates without a manual reload.

Repo state after completion:
- `createRunCoordinator` accepts `runtimeEvents: RuntimeEventPublisher` and publishes at four lifecycle points: run created, each reasoning entry appended, run completed (with response entry and session update), and run failed.
- `createApp` passes the app-level `runtimeEvents` instance to the run coordinator.
- A private `fetchSessionDto` helper in the coordinator re-fetches the session with entry count for session event payloads.
- The client `useRuntimeSubscription` now receives live run/session-entry/session events and invalidates the correct query caches without a manual reload.

## Phase 3: Assistant Session Workflow — COMPLETE

- Finish assistant submit wiring so the input actually drives the V2 run flow.
- Implement UI-local new-session behavior and first-run promotion into a persisted titled session.
- Lock `Include party context` after the first persisted prompt in a session.
- Render assistant in-flight behavior in the intended shape, including visible thinking state and intermediate reasoning entries.
- Keep the assistant feed behavior aligned with the persisted session/run model rather than ad hoc client-only state.
- Human testable:
  - Create a new assistant session.
  - Submit the first prompt and watch it promote into a titled saved session.
  - Submit a later prompt and confirm party-context locking is enforced.

Repo state after completion:
- `useRun` submits without a `sessionId` for temp sessions and calls `promoteSession` once the first run resolves, switching the active session to the real persisted one.
- `SessionProvider` manages the temp-to-persisted transition via `createTempSession` / `promoteSession`; `TEMP_SESSION_ID` is the sentinel that guards the lock check.
- `Input.tsx` disables the "Include party context" checkbox whenever the active session is a real (non-temp) persisted session.
- `Assistant.tsx` renders the feed grouped by run with user, reasoning, and response entries styled via `Assistant.module.css`; shows a `Thinking…` indicator while `activeRunId` is set; includes a sticky table-of-contents hover panel (`AssistantTableOfContents`).
- All Phase 3 behaviors are covered by passing tests in `tests/client-components.test.tsx` and `tests/client-session-context.test.tsx`.

## Phase 4: NPC Workflow Completion — COMPLETE

- Finish the shared run path for NPC mode, including NPC persistence/finalization behavior.
- Replace placeholder NPC-session workflow behavior with the real V2 session/run flow.
- Surface the existing server-side NPC filter/pagination support in the client.
- Keep NPC cards rendered across sessions while clearly marking cards that belong to the active session.
- Human testable:
  - Generate NPCs in one session.
  - Confirm cards persist after reload.
  - Filter or page through the list and verify active-session cards are visibly distinguished.
  - Confirm the legacy NPC session shows "(read-only)" in the selector and that Submit is disabled when it is active.

Repo state after completion:
- `executeNpcRun` (in `src/server/services/run/runtime-npc.ts`) implements the full NPC retrieval + tool-call loop, XML parsing, and a repair step if the first parse fails. `run-runtime-npc.ts` is isolated from the shared assistant runtime.
- `createRunCoordinator` no longer throws `run-unsupported-mode` for NPC sessions; it branches on `normalized.mode === 'npc'` and inserts parsed NPC records into the `npcs` table within the completion transaction.
- `useNpcsQuery` accepts `{ filter?, skip?, take? }` params and extends the query key to include them.
- `npcQueryKey` is invalidated in `useRuntimeSubscription` whenever a `run` event is received, keeping the NPC card list live.
- `NpcCards` renders a filter input, pagination controls (Prev / Next with "Showing X–Y of Z"), and distinct loading vs. empty states.
- `NpcCard` applies the `inSession` CSS class when `isInSession` is true; `NpcCards` compares each NPC's `sessionId` to the active NPC session ID to set the prop.
- `LEGACY_NPC_SESSION_ID` is exported from `src/dto/sessions.ts`. `POST /api/v2/runs` returns 400 for this session ID; `SessionSelector` appends "(read-only)" to its option label; `Input.tsx` disables Submit when the legacy session is active.
- Legacy NPC migration (`migrateLegacyNpcs`) preserves original V1 NPC IDs from both the JSON state file and the legacy markdown log format.
- All Phase 4 behaviors are covered by passing tests across `tests/runs.test.ts`, `tests/runs-runtime.test.ts`, `tests/client-api.test.tsx`, `tests/client-components.test.tsx`, `tests/api.test.ts`, and `tests/migration.test.ts`.
- `POST /api/v2/runs` now returns immediately after the fast path (validation, session setup, initial transaction, first SSE events) with a partial `RunDto` (`status: 'running'`, user entry only). Model execution runs in `executeRunBackground` (fire-and-forget). The Thinking… animation now fires correctly during runs. `RunCoordinator` gained a `drain()` method for test synchronization.

## Phase 5: V2 Product Completion

- Close all known product gaps before declaring V2 complete. Phases 1–4 delivered the core workflows; this phase addresses the correctness bugs and missing surfaces that fell outside those phase scopes.
- Server items:
  - Fix the orphan-session bug: move `insertNewSession` inside the main run transaction in `src/server/services/run/coordinator.ts` so a failed run never leaves a stranded empty session row in the selector.
  - Add an `orderBy` clause to `GET /api/v2/sessions` so sessions appear newest-first in the selector.
  - ~~Resolve the `provider.ts` and `retrieval-tool.ts` technical-debt markers.~~ Done: both files were fully refactored. The diagnostic system (`ChatCompletionDiagnostic`, `onDiagnostic`, `debug` option) was removed as dead V1 overhead, `completeStructured` was made required on `ChatAdapter` (eliminating the optional-method wrapper in `retrieval-tool.ts`), and a broader overengineering review of the server produced eight additional cleanups: `visibility` made required in `RefreshCoordinatorDependencies`, `createConsoleEventPublisher` made synchronous, `ProgressReporter.progress` removed, `app.ts` path resolution simplified to resolve only `retrievalDir`, `refreshStateStore.ensure()` removed from `startRefresh()`, `StartupOrchestrator` merged into a single `initialize()`, `providerDebug` renamed to `consolePersist`, and a JSDoc comment added to `ConsoleEventPublisher.debug()`.
- Client items (explain what is ready, let the user decide whether to implement personally):
  - NPC mode needs a console-like feed of intermediate reasoning entries rendered during and after a run, ordered oldest-to-newest with the Thinking… indicator at the end. The feed data is already fetched via the session feed query; it just needs to be surfaced in `NpcCards`.
  - `Input.tsx` should disable Submit while a refresh or reingest is active. The server already blocks the run correctly; this closes the UX gap. Wire `useRefreshQuery` into the Submit disabled state alongside the existing checks.
- Human testable:
  - Submit a first prompt on a new session that fails mid-run; reload and confirm no orphan session row appears in the selector.
  - Create several sessions; confirm the selector lists them newest-first.
  - Start an NPC run; confirm intermediate reasoning steps appear in a console-like feed above the card grid while the run is in progress.
  - Trigger a manual refresh; confirm Submit is visibly disabled for the duration.

## Phase 6: V1 Purge and Final Cleanup

- Only begin this phase once Phase 5 is complete.
- Remove the migration CLI: delete `src/server/migrate-v1-to-v2.ts` and `src/server/migrate-v1-to-v2.cli.ts` (both carry explicit "delete during the v1 purge" comments), and remove the `migrate:v1-to-v2` npm script from `package.json`.
- Update `docs/fdd-v2.md` to close the open console-GET question (SSE-only is correct; no GET endpoint needed) and capture any other settled-behavior notes that drifted during implementation.
- Leave the repo in a V2-only product state. The `LEGACY_NPC_SESSION_ID` protection (session selector label, `POST /api/v2/runs` 400 guard) is permanent data protection for migrated users and must not be removed.
- Human testable:
  - V2 still starts and runs correctly with the migration scripts absent.
  - `npm run verify` passes.

## Phase 7: Agent-Governance Cleanup

- Treat this phase as separate follow-up work because it will require `Introspection` mode.
- Remove this temporary planning document once it is no longer needed.
- Clean up `CLAUDE.md`, `docs/agent-modes.md`, and any other transition-era agent instructions that only existed to support the V1 to V2 migration.
- Leave the remaining agent-governance docs aligned with the repo's post-migration steady state.
- Human testable:
  - Not applicable beyond confirming the product still works after the prior phase; this phase is primarily documentation and workflow cleanup.
