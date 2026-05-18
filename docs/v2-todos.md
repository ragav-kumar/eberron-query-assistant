# V2 Server TODOs

Brief model-facing checklist for the remaining V2 server work, based on `docs/fdd-v2.md` and the current `src/server/v2` implementation.

## TOC

- [Core Processing](#core-processing)
- [Events And Console](#events-and-console)
- [Startup](#startup)
- [Read Side And Settings](#read-side-and-settings)
- [V1 Disposition](#v1-disposition)

## Core Processing

- [ ] Implement `POST /api/v2/refresh` in `refreshCoordinator`.
  - Own refresh vs reingest exclusivity and interruption rules.
  - Drive `refreshState` through pending/running/completed/failed.
  - Run the real refresh/reingest pipeline.

- [ ] Implement `POST /api/v2/runs` in `runCoordinator`.
  - Support both existing sessions and first-run promotion from transient UI session state.
  - Persist runs, user entries, reasoning entries, final responses, and NPC rows.
  - Execute assistant/NPC mode with retrieval, additional context, and optional party context.

## Events And Console

- [ ] Finish `GET /api/v2/events/console`.
  - Route should subscribe/unsubscribe correctly and emit SSE frames.
  - Publisher should keep subscribers and push live console events.

- [ ] Finish `GET /api/v2/events/runtime`.
  - Route should subscribe/unsubscribe correctly and emit SSE frames.
  - Publisher should emit refresh/run/session update events in the DTO shapes the V2 client expects.

- [ ] Decide whether `GET /api/v2/console` remains SQLite-backed or becomes process-local/transient.
  - `docs/fdd-v2.md` describes console as fundamentally transient.

## Startup

- [ ] Finish startup orchestration.
  - Keep singleton bootstrap work.
  - Trigger the automatic routine refresh on app launch.
  - Wire any startup-time console/runtime event publication needed by the UI.

## Read Side And Settings

- [ ] Keep the read-side endpoints as the stable baseline unless new processing work forces follow-on changes.
  - `GET /api/v2/additional-context`
  - `PUT /api/v2/additional-context`
  - `GET /api/v2/sessions`
  - `GET /api/v2/sessions/:sessionId/feed`
  - `GET /api/v2/npcs`
  - `GET /api/v2/console`

- [ ] Preserve the V2 settings split.
  - Prompt assets live under `src/server/v2/prompts/`.
  - Mutable settings like additional context and provider/campaign values live in SQLite `settings`.

## V1 Disposition

- [ ] Use V1 code selectively, not wholesale.
  - Best reuse candidates: provider, retrieval, source-discovery logic.
  - Port in pieces: ingestion, runtime helpers, progress abstractions.
  - Do not carry forward V1 file-backed state/session persistence as V2 architecture.
