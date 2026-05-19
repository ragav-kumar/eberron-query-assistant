# V2 TODOs

Brief model-facing checklist for the remaining V2 work, based on `docs/fdd-v2.md` and the current `src/server/v2` and `src/client/v2` implementation.

## TOC

- [Completed Baseline](#completed-baseline)
- [Run And Session Workflow](#run-and-session-workflow)
- [Runtime Events](#runtime-events)
- [Client Workflow Follow-Through](#client-workflow-follow-through)
- [V1 Disposition](#v1-disposition)

## Completed Baseline

- [x] Implement `POST /api/v2/refresh` in `refreshCoordinator`.
  - Own refresh vs reingest exclusivity and interruption rules.
  - Drive `refreshState` through pending/running/completed/failed.
  - Run the real refresh/reingest pipeline.

- [x] Finish `GET /api/v2/events/console`.
  - Route subscribes and unsubscribes correctly and emits SSE frames.
  - Publisher keeps subscribers and pushes live console events.

- [x] Finish `GET /api/v2/events/runtime` for refresh events.
  - Route subscribes and unsubscribes correctly and emits SSE frames.
  - Publisher emits refresh DTO events the V2 client already uses.

- [x] Finish startup orchestration for refresh.
  - Keep singleton bootstrap work.
  - Trigger the automatic routine refresh on app launch.
  - Reuse the same refresh visibility path for startup and manual refresh.

- [x] Decide the default `GET /api/v2/console` behavior.
  - Console is process-local and transient by default.
  - SQLite mirroring remains opt-in via provider debug.

- [x] Keep the current read-side endpoints as the baseline.
  - `GET /api/v2/additional-context`
  - `PUT /api/v2/additional-context`
  - `GET /api/v2/sessions`
  - `GET /api/v2/sessions/:sessionId/feed`
  - `GET /api/v2/npcs`
  - `GET /api/v2/console`

- [x] Preserve the V2 settings split.
  - Prompt assets live under `src/server/v2/prompts/`.
  - Mutable settings like additional context and provider/campaign values live in SQLite `settings`.

## Run And Session Workflow

- [ ] Implement `POST /api/v2/runs` in `runCoordinator`.
  - Support both existing sessions and first-run promotion from transient UI session state.
  - Persist runs, user entries, reasoning entries, final responses, and NPC rows.
  - Execute assistant and NPC mode with retrieval, additional context, and optional party context.
  - Update session title, `activeRunId`, and run status timestamps.

- [ ] Build the shared V2 run execution path instead of routing through V1 session persistence patterns.
  - Reuse provider, retrieval, and party-context capabilities selectively.
  - Keep V2 persistence in SQLite `sessions`, `runs`, `sessionEntries`, and `npcs`.
  - Keep assistant and NPC mode as the same fundamental workflow with mode-specific finalization.

- [ ] Generate and persist session titles on first successful persisted run.
  - The client spec expects transient pre-session state to be replaced by a titled persisted session.

- [ ] Enforce run blocking while refresh or reingest is active.
  - `docs/fdd-v2.md` requires assistant interactions to be disabled during corpus operations.

## Runtime Events

- [ ] Finish runtime event publication beyond refresh.
  - Emit `run` lifecycle events in the DTO shapes the V2 client expects.
  - Emit `session-entry` append events for user, reasoning, and response entries.
  - Emit `session` promotion and update events when a transient UI session becomes persisted or when session metadata changes.

- [ ] Wire `createV2App` to construct a real `runCoordinator` with the dependencies it needs.
  - The app currently creates a stub coordinator even though refresh/runtime/console infrastructure is in place.

## Client Workflow Follow-Through

- [ ] Finish submit wiring for the V2 input workflow.
  - The input submit button is not currently wired to invoke the run flow correctly.

- [ ] Finish transient session UX.
  - `New session` still needs to create UI-local temporary session state.
  - The first persisted run should promote and replace that temporary state cleanly.

- [ ] Fix active-session selection behavior.
  - Session selection currently has an argument-order bug between `SessionSelector` and `SessionProvider`.

- [ ] Lock `Include party context` after the first prompt in a persisted session.
  - This is required by `docs/fdd-v2.md`.

- [ ] Render in-flight run behavior expected by the V2 spec.
  - Show the animated thinking state while a run is active.
  - Render intermediate reasoning entries as they arrive.
  - Smooth-scroll to newly returned assistant output.

- [ ] Finish the NPC workflow UI around the shared run path.
  - Keep rendering cards from all sessions while marking cards from the active session.
  - Add server-driven filter and pagination controls for the NPC list.

## V1 Disposition

- [ ] Use V1 code selectively, not wholesale.
  - Best reuse candidates remain provider, retrieval, and source-discovery logic.
  - Port in pieces: run-time retrieval orchestration, prompt assembly helpers, and progress abstractions.
  - Do not carry forward V1 file-backed state or session persistence as V2 architecture.
