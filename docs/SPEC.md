# Eberron Query Assistant — Specification

This document is the authoritative, agent-facing specification for the Eberron Query Assistant. Consult it first when preparing for any implementation or review task.

---

## Invariants

These rules are unconditional.

- Do not use prior transcripts as silent prompt memory.
- Do not clear app-owned corpus artifacts during routine startup or restart.
- Do not treat Additional Context as retrieval corpus evidence; do not cite it as a source.
- Do not present unsupported inference as directly sourced claims.
- Do not overwrite saved NPC cards with invalid structured output.
- Do not record authorization headers or API keys in diagnostic output.
- Do not advance persisted state until ingestion and retrieval output are in a trustworthy condition.

---

## Product Purpose

- Queries and synthesizes an Eberron campaign corpus combining Foundry export data, local PDFs, and Keith Baker articles.
- Supported question types: direct lore lookup, campaign-specific lookup against Foundry records, cross-source comparison, synthesis-heavy inference, lore-aware NPC generation.
- Local-first: source files, runtime state, and generated data all live on the same machine.
- Prefer grounded answers with citations when supporting evidence is available.
- Active conversation memory is limited to the current session; saved artifacts are for user review and continuity only.

---

## Source Material

### Foundry Export Data

- Source folder: `foundry-export/`.
- Inputs are NDJSON export files representing retained export history, not a single current snapshot.
- Each export file begins with export-run metadata followed by record-level change entries (add, update, delete).
- Filenames must be lexicographically sortable in chronological order; lexicographic order is the export-history order.
- Routine refresh applies only unapplied export files, in lexicographic filename order.
- Force reingest rebuilds the Foundry-backed corpus by replaying the full retained export history.
- Foundry content covers campaign-specific entities: actors, journals, locations, organizations, and other world records.
- Preserve enough source identity for citations: entity name and entity kind where available.

### Local PDF Library

- Source folder: `pdf/`.
- Each PDF is a source document in the knowledge base.
- Cite PDFs by document title or filename, with page context when available.
- Unchanged PDFs are stable; do not reprocess them during routine refresh.
- Routine refresh recognizes newly added files and removes deleted files from the corpus.

### Keith Baker Articles

- Discovered from the Eberron article index; treated as structured long-form web content.
- Cite articles by title and URL.
- Maintain local article caching so full rebuilds can reuse previously captured raw content.
- Responses that are permanently inaccessible (consistent "not found" or forbidden) must be recorded and skipped on later runs, not retried indefinitely.

---

## Environment Configuration

### Provider Settings

- `OPENAI_API_KEY` — provider credentials; required for assistant and NPC operations.
- `OPENAI_BASE_URL` — provider base address; has a built-in default; allows compatible non-default provider deployments.
- `OPENAI_CHAT_MODEL` — model for assistant and NPC responses; has a built-in default.
- `OPENAI_EMBEDDING_MODEL` — model for retrieval embeddings; has a built-in default.
- If the API key is missing or provider settings are invalid: refresh may still inspect local files; assistant and NPC operations must fail clearly rather than produce misleading output.

### Party-Context Settings

All optional. If absent, incomplete, or referring to missing Foundry content: omit unavailable context, report the limitation when useful, and continue without failing the application.

- `EQA_PARTY_ACTOR_UUIDS` — identifies the active party members.
- `EQA_SESSION_NOTES_JOURNAL` — journal recording what has happened in play.
- `EQA_QUESTS_JOURNAL` — journal tracking active or expected quest threads.
- `EQA_CAMPAIGN_JOURNAL_FOLDER` — campaign journal grouping convention for broader campaign context.

### Diagnostic Setting

- `EQA_PROVIDER_DEBUG` — optional; off by default.
- When enabled: surfaces raw provider diagnostics in local debug output and a bounded local diagnostic log.
- Must never record authorization headers or API keys in saved diagnostic output.

---

## User Interface

### Left Column

- **Header area:** refresh controls, refresh status (last result: success, failure, or in-progress), and a gear button that opens the Settings modal.
- **Input area:**
  - Include party info toggle. Locked after the first prompt is sent in a session; party context is only included in the first prompt of a conversation.
  - Extra retrieval turns control (range `0`–`3`, default `1`).
  - Prompt textarea. The controls and prompt area always reflect the active right-column mode tab.
- **Console panel:** persistent footer panel at the bottom of the left column, always visible and resizable. Receives SSE events via the runtime `console` stream. Fundamentally transient; output is not persisted beyond the process lifetime. No GET endpoint is needed.

### Settings Modal

- Accessible via the gear icon in the header.
- Displays all user-configurable settings grouped by section.
- Each field saves individually on blur; boolean toggles save on change. No explicit Save button.
- A field with a validation error blocks save and prevents the modal from being dismissed.
- The modal cannot be dismissed while any save is in progress.
- Every write is logged to the console regardless of the consolePersist setting — this is the recovery path for accidental misconfiguration.

### Right Column

Two mode-based tabs: **Assistant** and **NPC Cards**.

- Mode selection is the tab system itself; there is no mode selector control on the Input tab.
- Each tab includes a session selector dropdown and a New Session button at the top.
- The session selector is pre-filtered to sessions of the appropriate kind.

#### Assistant Tab

- Renders the active session as a back-and-forth conversation feed: user prompts, model tool-call messages (reasoning steps), and final responses.
- Each (prompt → response) exchange is clearly delineated.
- On new data, smooth-scrolls to the top of the latest item.
- An animated "Thinking" indicator appears at the bottom of the feed while a model call is ongoing.
- When the active session has two or more exchanges, a sticky table of contents is shown.

#### NPC Cards Tab

- Split panel: **cards grid** on top, **exchange feed** drawer on bottom.
- **Cards grid:** renders NPC cards from all sessions, paginated and filterable. Cards from the currently active session are visually distinguished. Cards are sorted newest to oldest.
- **Exchange feed:** shows the active session's runs in order — user prompts, reasoning steps (`<thinking>` blocks, rendered with reasoning styling), and notes (`<notes>` blocks, rendered with response styling). The raw `<npcs>` XML block is not rendered in the feed; the cards grid serves that purpose.
- An animated "Thinking" indicator appears after the newest entry in the feed while a model call is ongoing.

### Interaction Rules

- Enter inserts a newline in the prompt textarea.
- Submission is via the Submit button or the Ctrl+Enter keyboard shortcut.
- Both Submit and Ctrl+Enter are disabled while a run is in progress or the session is locked (e.g., a legacy NPC session).
- While corpus management (refresh or reingest) is active, all assistant and NPC operations are disabled.
- Output panes follow new output as it arrives.

---

## Main Workflows

### Startup Refresh

- Triggered automatically via POST when the interface first connects to the local runtime.
- Inspects current Foundry export, PDF directory, and Keith Baker article discovery state.
- Reuses unchanged local state where possible.
- Skips retrieval maintenance entirely when discovery and ingestion found no changes.
- For Foundry: applies only unapplied export files; skips Foundry work entirely if no new files are present.
- Blocks overlapping assistant or NPC work until it finishes or fails.
- On failure: user can retry via manual refresh or by submitting a prompt.

### Routine Refresh

- Explicit user action; also triggered automatically at startup.
- Incremental maintenance, not a destructive rebuild.
- Checks sources and updates the local corpus only where needed.
- Must not discard app-owned corpus or retrieval artifacts because the app restarted or metadata changed.
- Preserves existing good state, skips unchanged work, reports progress through the Console.

### Force Reingest

- Explicit full rebuild action; triggered via a UI button.
- Requires a confirmation popup before starting.
- Interrupts and replaces an ongoing Routine Refresh. This is the only corpus action permitted while a Routine Refresh is running. Force Reingest itself cannot be interrupted.
- Only disabled if a reingest is already in progress.
- Bypasses normal incremental skip logic.
- Rebuilds corpus and retrieval artifacts from source material.
- Replays the retained Foundry export history to reconstruct the current Foundry-backed corpus.
- Refreshes article-derived content using cached raw content where available.
- Communicates clearly that a full rebuild is occurring.

---

## Session Lifecycle

- Sessions are created implicitly on the first POST to the runs endpoint when no `sessionId` is provided. There is no standalone session creation endpoint.
- The client may hold a temporary local session (sentinel ID `__temp__`) before the first run. This temp state is replaced by the real session ID after the first successful run.
- The session title is generated by the model on the first completed response and is durable once set.
- Sessions are pre-filtered by kind. The session selector in each mode tab shows only sessions of the appropriate mode.
- Session list filtering uses the `?mode=` query parameter, not a path parameter.
- Full session state is assembled from the session list endpoint and the session feed endpoint. There is no single "full session info" endpoint.

---

## Standard Assistant Workflow

- User asks a free-form question about lore, campaign facts, cross-source relationships, or inference-heavy topics.
- App gathers corpus evidence, optionally enriches with party context on the first prompt of a session, and returns an answer.
- Transcript is stored in the app database.
- When extra retrieval turns are used, the model writes short progress notes into the active session feed before the final answer. Each note is 1–3 sentences describing the model's reasoning, what it is searching for, and why it is relevant.

### Transcript Persistence

- All transcripts are stored in the app database (`sessions` and `sessionEntries` tables). No file-based transcript storage exists and no `logs/` directory is created.
- Session records are written when the first run begins; the title is finalized on first completed response.
- Older sessions are browsable via the session selector in the Assistant tab.

---

## NPC Generator Workflow

- User requests NPCs; the assistant is configured server-side to return structured NPC data.
- Uses the same corpus and optional party context as the Standard Assistant workflow.
- NPC IDs are assigned by the database (auto-increment). The model does not specify IDs. Every run creates new NPC records; in-place revision of existing cards is not supported.
- Reasoning entries (kind=`reasoning`) are persisted as `SessionEntry` rows in the database and are visible in the NPC exchange feed. They are not part of the NPC card set.

### NPC Response Envelope

The NPC response must be a structured XML envelope conforming to this shape:

```xml
<response>
  <response-title>...</response-title>
  <session-title>...</session-title>   <!-- required on first run in a session only -->
  <thinking>...</thinking>             <!-- reasoning; rendered in exchange feed with reasoning styling -->
  <notes>...</notes>                   <!-- narrative; rendered in exchange feed with response styling -->
  <npcs>
    <npc>
      <name>...</name>
      <bio>...</bio>
      <description>...</description>
      <!-- optional: <species>, <ethnicity>, <gender>, <role>, <age> -->
    </npc>
    <!-- additional <npc> blocks as needed -->
  </npcs>
</response>
```

- Required `<npc>` fields: `<name>`, `<bio>`, `<description>`.
- Optional `<npc>` fields: `<species>`, `<ethnicity>`, `<gender>`, `<role>`, `<age>`. Infer from the prompt where applicable.
- `<session-title>` is required only on the first run in a session.
- Infer how many NPCs are requested from the prompt itself.
- One repair attempt is issued for malformed responses. If repair fails, the run fails without saving NPC data; stored NPC records remain unchanged.

### NPC Display Rules

- The cards grid always renders the full saved NPC collection across all sessions, sorted newest to oldest.
- Cards from the currently active session are visually distinguished.
- Pagination and filtering are server-side: optional query params `skip`, `take`, and `filter`; response metadata includes `skip`, `take`, `total` count, and `activeFilter`.

---

## Retrieval and Answer Behavior

### Initial Retrieval Pass

- Every assistant-style request begins with an initial retrieval pass over the combined corpus.
- The pass provides evidence for straightforward questions and anchors inference-heavy responses in retrieved material.

### Extra Retrieval Turns

- Controlled by the Extra retrieval turns input (range `0`–`3`, default `1`).
- `0` still allows the initial pass but prevents additional targeted retrieval.
- The model may make `0` to the configured maximum calls to `search_corpus()` to request additional data.
- The same limit applies to both Assistant and NPC Generator modes.

### Citation Expectations

- Include references whenever supporting evidence is available.
- PDF: document title or filename, with page context when available.
- Keith Baker articles: article title and URL.
- Foundry-derived content: entity name and entity type when available.
- Distinguish quoted or directly supported claims from synthesis; do not present a synthesized conclusion as a direct quotation from one source.

### Progress Reporting

- Standard assistant with extra retrieval turns: write short progress notes (1–3 sentences) into the active session feed before the final answer.
- NPC Generator with extra retrieval turns: reasoning entries are persisted as session entries and rendered in the NPC exchange feed, not the transient Console panel.

---

## Additional Context

- Local prompt guidance authored by the user; not part of the retrieval corpus and not cited as a source.
- Intended for campaign notes, style guidance, local assumptions, or other assistant-only instructions.
- There is exactly one additional context document, shared across all modes and sessions.
- Included in prompts only when it contains text.
- Editable via the Settings modal.
- Local-only; not treated as transcript memory.

---

## API Reference

### Corpus Management

- **GET corpus status** — single request returning whether a refresh or reingest is currently in progress, and when the last refresh/reingest run completed. Used by the UI to gate assistant and NPC interactions.
- **POST refresh** — triggers routine refresh. Called automatically on app launch and by the Refresh UI button.
- **POST reingest** — triggers force reingest. Called by the Force Reingest UI button after confirmation. Interrupts an ongoing refresh.

### Settings

- **GET settings** — returns the full list of user-configurable settings with current values and metadata (type, label, section, constraints). Called on app launch.
- **PUT settings** — updates a single setting by key. Every write is logged to the console.

### Sessions

- **GET sessions** — list session summaries. Optional `?mode=` query parameter filters by session kind. NPC list data is not embedded in the session DTO.
- **GET session feed** — ordered run and entry history for a session, identified by a session ID path parameter.

### Runs

- **POST runs** — sends a new prompt against an ongoing or new session. Accepts an optional `sessionId`; if omitted, creates a new session atomically. Returns the real session ID, enabling the client to promote a `__temp__` session to the persisted ID.

### NPCs

- **GET NPC list** — paginated, filterable NPC list across all sessions. Query params: `skip`, `take`, `filter`. Response includes metadata: `skip`, `take`, `total`, `activeFilter`. NPC data is not embedded in session DTOs.

---

## Runtime File Locations

### Source Locations

- `foundry-export/` — NDJSON export files; lexicographic filename order matches export chronology.
- `pdf/` — PDF source documents.
- `assistant/additional-context.md` — additional context file.
- `.env` — environment configuration.

### Runtime Root

`.eberron-query-assistant/` stores all app-owned local state and derived artifacts:

- `.eberron-query-assistant/state/` — persisted runtime state and app database.
- `.eberron-query-assistant/cache/` — scrape and parse caches.
- `.eberron-query-assistant/cache/keith-baker/` — cached Keith Baker index and article HTML.
- `.eberron-query-assistant/retrieval/` — searchable local corpus and retrieval artifacts.
- `.eberron-query-assistant/provider-debug.jsonl` — bounded debug and provider-diagnostic output (debug mode only).

### Other Artifacts

- `.test-tmp/timing.jsonl` — local timing diagnostics.

### Retired Locations

The following locations existed in earlier design documents but are no longer part of the implementation:

- `logs/` — file-based transcript logs are retired. All session and transcript data is stored in the app database.
- `.eberron-query-assistant/state/generated-npcs.json` — file-based NPC storage is retired. NPC data is stored in the app database (`npcs` table).

---

## Output Artifacts and Persistence

### Session and Transcript Data

- All session and transcript data is stored in the app database (`sessions` and `sessionEntries` tables).
- Session records are created when the first run begins; the title is finalized on first completed response.
- Older sessions are browsable via the session selector in the appropriate mode tab.

### NPC Data

- NPC cards are stored in the app database (`npcs` table).
- IDs are database-assigned (auto-increment); the model does not control IDs.
- The database is the authoritative store; NPC data is never loaded as prompt memory.

### Runtime State

Tracks enough information to support incremental refresh decisions:

- Last successfully applied Foundry export file or run marker.
- Known PDF inventory.
- Keith Baker article discovery and scrape status.
- Retrieval bookkeeping needed for stale-entry cleanup.

Updated only after work has completed successfully enough to trust.

---

## Failure, Degraded, and Recovery Behavior

### Source-Scoped Failure

- Failure in one source pipeline must not automatically invalidate all others.
- If at least one source class remains usable, the app may continue in degraded mode after clearly naming the affected source type.
- Examples: article discovery failure while Foundry and PDFs remain usable; missing party-context journals while the broader corpus remains usable; one source partially refreshed while others stayed current.

### Empty-Corpus Failure

- If no usable retrieval corpus can be produced, the application must fail clearly rather than attempt to answer.

### Safe State Advancement

- Persisted state must not advance until ingestion and retrieval outputs are in a trustworthy condition.
- If refresh fails after partial work, the previous trusted state must remain available so the next run can retry safely.

### Reconnect Recovery

- If the interface reloads or reconnects while the same local runtime process is still alive, restore the current in-process operation status and the transient Console feed accumulated so far.
- If the local runtime process stops, transient recovery state is intentionally lost.
