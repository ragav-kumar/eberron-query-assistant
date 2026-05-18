# V2 Server TODOs

This note captures the current V2 server gaps based on `docs/fdd-v2.md` and the existing `src/server/v2` implementation.

## Summary

The four unfinished V2 processing endpoints are still:

1. `POST /api/v2/runs`
2. `POST /api/v2/refresh`
3. `GET /api/v2/events/console`
4. `GET /api/v2/events/runtime`

However, the implementation status is now split across routes and services:

- `POST /api/v2/runs` and `POST /api/v2/refresh` are routed through app-level services in `src/server/v2/services/`.
- `GET /api/v2/events/console` and `GET /api/v2/events/runtime` are only partially wired. They now open the SSE stream, but still need route-level transport adapter work and real publisher behavior.
- App-launch work now has a dedicated startup service in `src/server/v2/services/startup-orchestrator.ts`, but it is still only partially implemented.

There are also supporting runtime gaps around startup orchestration that those endpoints depend on.

## Important Adjacent Gaps

### App-level runtime services now exist, but are still stubbed

V2 now has app-level service interfaces and implementations under `src/server/v2/services/` for:

- console event publishing
- runtime event publishing
- refresh coordination
- run coordination

These services are present in `V2AppContext`, but their current implementations still emit warnings and `TODO`s instead of doing real work.

### Startup orchestration exists, but is still only a stubbed bootstrap layer

V2 now has a dedicated startup orchestrator service that `createV2App()` invokes at app creation time.

Right now it does two things:

- ensures the singleton `refreshState` row exists
- emits a warning that startup orchestration is not fully implemented

What is still missing is the rest of the startup-origin work, especially automatic routine refresh behavior and any startup-time event publication needed by the UI.

## Work By Trigger

### App launch

Work still needed:

- Trigger the automatic routine refresh described in `docs/fdd-v2.md`.
- Finish live SSE subscriptions for runtime and console events.

Notes:

- The V2 client already opens the SSE subscriptions on launch.
- The server services for those subscriptions are stubbed.
- The server event routes also still need route-level SSE adapter work.
- The `refreshState` singleton row is now created during startup orchestration.
- I do not currently see startup wiring for an automatic routine refresh.

### `GET /api/v2/additional-context`

Current state:

- Implemented.
- Reads the singleton markdown value from `settings`.

Additional work:

- None obvious from this review.

### `PUT /api/v2/additional-context`

Current state:

- Implemented.
- Upserts the singleton markdown value into `settings`.

Additional work:

- None obvious from this review.

### `GET /api/v2/sessions`

Current state:

- Implemented.
- Returns session summaries, optionally filtered by mode.

Additional work:

- None obvious from this review.

### `GET /api/v2/sessions/:sessionId/feed`

Current state:

- Implemented.
- Returns persisted runs and session entries for one session.

Additional work:

- None obvious from this review on the read side.

### `GET /api/v2/npcs`

Current state:

- Implemented.
- Returns paged, filtered NPC cards.

Additional work:

- None obvious from this review on the read side.

### `GET /api/v2/console`

Current state:

- Implemented.
- Returns rows from `consoleEntries`.

Additional work:

- Confirm whether this should remain persisted in SQLite or be made process-local, since `docs/fdd-v2.md` describes console as fundamentally transient.

### `POST /api/v2/refresh`

Current state:

- The route is wired to `refreshCoordinator.startRefresh(...)`.
- The current coordinator implementation is still a stub.

Work still needed:

- Enforce the flow rules:
  - refresh should run automatically on app launch and also via UI button
  - force reingest should require confirmation on the client
  - force reingest should be allowed to interrupt an ongoing refresh
- Update `refreshState` through pending, running, completed, and failed transitions.
- Maintain `activeOperation`, `lastRefreshAt`, `lastReingestAt`, and `updatedAt`.
- Invoke the actual refresh/reingest pipeline.
- Emit runtime events for refresh lifecycle changes.
- Emit console entries if operational progress should appear in the console feed.

### `POST /api/v2/runs`

Current state:

- The route is wired to `runCoordinator.startRun(...)`.
- The current coordinator implementation is still a stub.
- The placeholder mock run payload has been removed; the stub now warns and throws.

Work still needed:

- Support both:
  - starting a run against an existing session
  - creating a new durable session from a transient UI-local session
- Create or update the session and set `activeRunId`.
- Persist the user prompt as a session entry.
- Execute the assistant pipeline for the requested mode.
- Supply the prompt with:
  - optional party context when allowed
  - optional additional context
  - required retrieved corpus data
- Support up to the configured retrieval tool-call limit.
- Persist reasoning entries for tool-call chatter.
- Persist the final response entry.
- Update run status through pending, running, completed, and failed.
- Clear or update `activeRunId` when the run finishes.
- Update or generate the session title when the first persisted run completes.
- Persist generated NPC rows for NPC mode.
- Emit runtime events for:
  - run lifecycle changes
  - session-entry append events
  - session promotion or session update events

### `GET /api/v2/events/console`

Current state:

- The route now opens the SSE stream with `writeSse(...)`.
- The route and publisher both explicitly warn that the implementation is incomplete.

Work still needed:

- In the route:
  - subscribe a callback with the publisher
  - serialize console events into SSE frames with `response.write(...)`
  - unsubscribe the callback on request close
- In the publisher:
  - maintain subscriber registration
  - publish live console entries
  - define the relationship between process-local console events and persisted `consoleEntries`

### `GET /api/v2/events/runtime`

Current state:

- The route now opens the SSE stream with `writeSse(...)`.
- The route and publisher both explicitly warn that the implementation is incomplete.

Work still needed:

- In the route:
  - subscribe a callback with the publisher
  - serialize runtime events into SSE frames with `response.write(...)`
  - unsubscribe the callback on request close
- In the publisher:
  - maintain subscriber registration
  - publish structured runtime/resource events for:
    - refresh lifecycle changes
    - run lifecycle changes
    - session-entry append events
    - session promotion/update events
  - match the DTO shapes already defined for runtime events so the existing V2 client invalidation logic works correctly

## Conclusion

The V2 API is close on the read side and singleton additional-context editing, and the unfinished processing paths are now at least separated into app-level services plus route adapters.

The remaining gaps are now clearer:

- `POST /runs` and `POST /refresh` are service-backed, but their services are still stubbed.
- `GET /events/console` and `GET /events/runtime` still need both real publisher behavior and route-level SSE adapter expansion.
- Startup orchestration exists, but only as a bootstrap stub; the automatic app-launch behavior is still missing.
