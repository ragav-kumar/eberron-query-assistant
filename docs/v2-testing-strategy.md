# V2 Testing Strategy

## Purpose
- Use this doc to decide what V2 tests should exist across the remaining phases.
- Keep the suite focused on repo behavior, stable contracts, and durable invariants.
- Do not preserve existing tests by default. Use this doc as the target state for later test burn-down work.

## Rules
- Test V2 behavior, not V1 behavior, unless the migration path still matters to V2.
- Prefer unit tests at stable seams over broad runtime setup.
- Use integration tests only when the boundary itself is the thing being validated.
- Test our request payloads, persistence behavior, state transitions, DTOs, and rendered output.
- Mock provider calls, network fetches, EventSource clients, editor internals, and parser-library behavior unless the boundary contract itself is under test.
- Add coverage for new V2 work when the feature lands. Do not defer obvious coverage for already-implemented behavior.

## Current Shape
- Existing tests are mostly server-side.
- Current coverage already touches API routing, runs, refresh, corpus/retrieval, migration, and server hosting.
- V2 client coverage is effectively absent.
- Several current tests are broader integration tests using temp filesystem state and real SQLite. Do not treat that as the default pattern.

## Targets
### API, Routes, SSE
- Test now:
  - Route matching for implemented `/api/v2` paths.
  - Request parsing, response status mapping, and error bodies.
  - SSE framing, headers, and event payload shaping for console/runtime streams.
- Add when implemented:
  - Any new V2 route contract introduced in later phases.
  - DTO behavior for temporary-session promotion and future run/session runtime events.
- Mock instead:
  - Router internals.
  - Browser `EventSource` implementation details.

### Session And Run Lifecycle
- Test now:
  - Session validation, mode validation, and run blocking during refresh/reingest.
  - Run persistence, session-entry persistence, session title updates, and `activeRunId` cleanup.
  - Failure durability for malformed or failed assistant runs.
- Add when implemented:
  - Temporary-session creation and first-run promotion.
  - Session creation flows beyond persisted-session-only Phase 1 behavior.
  - Mode-specific session visibility rules required by the final V2 UI.

### Assistant Execution And Retrieval Loop
- Test now:
  - Prompt assembly and persisted-history reconstruction.
  - Retrieval turn limiting and tool-call loop handling.
  - Thinking/reasoning entry persistence.
  - Invalid assistant envelope and repair/failure behavior.
- Add when implemented:
  - Full multi-step run event publication.
  - Any richer assistant-mode rendering or exchange-grouping rules added later.
- Mock instead:
  - Provider/model quality.
  - OpenAI chat behavior.

### NPC Workflow
- Test now:
  - Only current server behavior that already exists for NPC listing, filtering, and pagination.
- Add when implemented:
  - Structured NPC run execution.
  - NPC persistence/finalization from runs.
  - Active-session card marking and cross-session rendering workflow.
  - NPC mode session lifecycle distinct from assistant mode.
- Mock instead:
  - Provider structured-output behavior.

### Refresh And Reingest Workflow
- Test now:
  - Refresh state transitions.
  - Conflict rules and reingest interruption semantics.
  - Startup recovery behavior.
  - Console/runtime event publication.
  - Run blocking while refresh or reingest is active.
- Add when implemented:
  - UI confirmation and disabling behavior around force reingest.
  - Any future runtime-event fanout added for richer client updates.

### Discovery, Ingestion, Corpus Construction
- Test now:
  - Foundry manifest and NDJSON validation.
  - Discovery decisions for foundry, article, and PDF sources.
  - Change-set generation and source provenance shaping.
  - Empty-corpus and invalid-source failure behavior.
- Add when implemented:
  - Any new source types or ingestion stages added in later phases.
- Mock instead:
  - Cheerio parsing internals.
  - PDF parser correctness.
  - Remote article fetch behavior beyond our request/response handling.

### Retrieval And Party Context
- Test now:
  - Retrieval refresh bookkeeping.
  - Embedding cache reuse behavior.
  - Search-result shaping and source typing.
  - Party-context assembly from stored corpus rows.
- Add when implemented:
  - Any new retrieval result shaping required by later assistant/NPC flows.
  - Any final party-context inclusion rules not yet wired into the full V2 session workflow.
- Mock instead:
  - Embedding-provider behavior.

### Settings, Startup, Migration Boundary
- Test now:
  - Default setting initialization.
  - Persisted setting parsing.
  - Relative-path enforcement.
  - Startup bootstrap behavior.
  - V1-to-V2 migration behavior that still matters during the transition.
- Add when implemented:
  - Any new persisted V2 settings or startup recovery branches added in later phases.
- Do not add:
  - New V1 product tests unrelated to migration.

### Client Session And Subscription State
- Test now:
  - None yet by default, because the current client state layer is still thin and uncovered.
- Add when implemented:
  - Session selection and active-session/feed composition.
  - Runtime-event invalidation behavior.
  - Console stream accumulation and deduplication.
  - Tab-local state behavior that affects user-visible workflow.
- Mock instead:
  - React Query internals.
  - Browser SSE internals.

### Client Interaction And Rendering
- Test now:
  - None yet by default, unless a specific V2 client bug fix lands and needs regression coverage.
- Add when implemented:
  - Submit payload construction.
  - Busy/disabled state behavior.
  - Additional-context load/save workflow.
  - Include-party-context locking after the first persisted prompt.
  - Assistant exchange rendering shape, thinking state, and smooth-scroll behavior.
  - NPC card rendering, active-session highlighting, and server-driven pagination/filter UX.
- Mock instead:
  - Markdown renderer internals.
  - MDX editor internals.

## Packages
- Keep:
  - `vitest`
  - `@testing-library/react`
  - `jsdom`
- Likely add:
  - `@testing-library/user-event`
  - `msw`
- Likely useful:
  - `tempy` or `tmp-promise`
- Optional:
  - `supertest` if the suite shifts toward higher-level HTTP boundary tests

## Do Not Test Directly
- SQLite correctness.
- `better-sqlite3` behavior.
- Kysely internals.
- Router internals.
- Provider/model quality.
- Browser `EventSource` internals.
- `react-markdown` internals.
- `@mdxeditor/editor` internals.
- Cheerio internals.
- PDF parser-library correctness.
- React Query internals.
