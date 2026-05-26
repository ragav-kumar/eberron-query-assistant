# Eberron Query Assistant — V1 Design Reference

## Invariants

- Do not use prior transcripts as silent prompt memory.
- Do not clear app-owned corpus artifacts during routine startup or restart.
- Do not treat Additional Context as retrieval corpus evidence; do not cite it as a source.
- Do not present unsupported inference as directly sourced claims.
- Do not overwrite saved NPC cards with invalid structured output.
- Do not record authorization headers or API keys in diagnostic output.
- Do not advance persisted state until ingestion and retrieval output are in a trustworthy condition.

## Product Purpose

- Queries and synthesizes an Eberron campaign corpus combining Foundry export data, local PDFs, and Keith Baker articles.
- Supported question types: direct lore lookup, campaign-specific lookup against Foundry records, cross-source comparison, synthesis-heavy inference, lore-aware NPC generation and revision.
- Local-first: source files, runtime state, transcripts, caches, and generated NPC data all live on the same machine.
- Prefer grounded answers with citations when supporting evidence is available.
- Active conversation memory is limited to the current session; saved artifacts are for user review and continuity only.

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

## User Interface

### Left Column

- Header area with refresh controls and refresh status (last result: success, failure, or in-progress).
- `Input` tab:
  - Shared `Include party info` toggle.
  - Shared `Extra retrieval turns` control (range `0`–`3`).
  - Mode selector: `Standard` and `NPC Generator`.
  - Prompt entry area for the active mode.
- `Additional Context` tab: editor for local assistant-only notes; not ingested as corpus content.

### Right Column

- `Console` tab: transient operational output (progress, refresh messages, warnings, errors, diagnostics).
- `Log` tab: persisted standard-assistant transcript output; supports browsing saved sessions with structured question-and-answer sections and a table of contents.
- `NPCs` tab: saved NPC cards in a space-aware tiled layout when the pane is wide enough.

### Interaction Rules

- Enter submits the active prompt.
- Shift+Enter inserts a new line in text entry areas.
- Inputs remain visible until a request succeeds.
- Output panes follow new output as it arrives.
- Long-running operations visibly lock overlapping actions; the user cannot start conflicting work while one is active.

## Main Workflows

### Startup Refresh

- Performed once when the interface first connects to the local runtime.
- Inspects current Foundry export, PDF directory, and Keith Baker article discovery state.
- Reuses unchanged local state where possible.
- Skips retrieval maintenance entirely when discovery and ingestion found no changes.
- For Foundry: applies only unapplied export files; skips Foundry work entirely if no new files are present.
- Blocks overlapping assistant or NPC work until it finishes or fails.
- On failure: user can retry via manual refresh or by submitting a prompt.

### Routine Refresh

- Explicit user action; incremental maintenance, not a destructive rebuild.
- Checks sources and updates the local corpus only where needed.
- Must not discard app-owned corpus or retrieval artifacts because the app restarted or metadata changed.
- Preserves existing good state, skips unchanged work, reports progress through the Console.

### Force Reingest

- Explicit full rebuild action; requires user confirmation before starting.
- Bypasses normal incremental skip logic.
- Rebuilds corpus and retrieval artifacts from source material.
- Replays the retained Foundry export history to reconstruct the current Foundry-backed corpus.
- Refreshes article-derived content using cached raw content where available.
- Communicates clearly that a full rebuild is occurring.

### Standard Assistant Workflow

- User asks a free-form question about lore, campaign facts, cross-source relationships, or inference-heavy topics.
- App gathers corpus evidence, optionally enriches with party context, and returns an answer for direct reading.
- Persists transcript output to the current writable session in the `Log` tab.

### NPC Generator Workflow

- User requests NPCs or revises existing saved NPCs.
- Uses the same corpus and optional party context as the standard workflow.
- Final output must conform to the structured NPC-card shape before being saved.
- Displays output in the `NPCs` tab.

## Retrieval and Answer Behavior

### Initial Retrieval Pass

- Every assistant-style request begins with an initial retrieval pass over the combined corpus.
- The pass provides evidence for straightforward questions and anchors inference-heavy responses in retrieved material.

### Extra Retrieval Turns

- Controlled by the `Extra retrieval turns` input (range `0`–`3`, default `1`).
- `0` still allows the initial pass but prevents additional targeted retrieval.
- The same limit applies to both Standard and NPC Generator workflows.

### Citation Expectations

- Include references whenever supporting evidence is available.
- PDF: document title or filename, with page context when available.
- Keith Baker articles: article title and URL.
- Foundry-derived content: entity name and entity type when available.
- Distinguish quoted or directly supported claims from synthesis; do not present a synthesized conclusion as a direct quotation from one source.

### Progress Reporting

- Standard assistant with extra retrieval turns: write short progress notes into the active transcript before the final answer.
- NPC Generator with extra retrieval turns: keep intermediate progress in the transient Console; do not save it as part of the NPC record set.

## NPC Generation Behavior

### Card Shape

Required fields:
- Numeric identifier
- Name
- Physical description
- Very short biography

Optional fields (infer from the prompt where applicable):
- Species
- Ethnicity
- Gender
- Role
- Approximate age

- Infer how many NPCs are requested from the prompt itself.

### Revision Rules

- If the model returns an existing numeric identifier, update that NPC card in place.
- New cards must use identifiers above the current maximum saved identifier.
- Invalid final structured output must not overwrite saved NPC state.
- A single repair attempt for malformed structured output is permitted; if the result still fails validation, the request fails clearly and previously saved data remains unchanged.

### Display Rules

- The `NPCs` tab always renders the saved card collection from runtime state, sorted newest updates first.
- Switching prompt modes must not delete persisted NPC cards.

## Additional Context

- Local prompt guidance authored by the user; not part of the retrieval corpus and not cited as a source.
- Intended for campaign notes, style guidance, local assumptions, or other assistant-only instructions.
- Created empty if it does not yet exist.
- Included in prompts only when it contains text.
- Editable in-app.
- Local-only; not treated as transcript memory.

## Runtime File Locations

### Source Locations

- `foundry-export/` — NDJSON export files; lexicographic filename order matches export chronology.
- `pdf/` — PDF source documents.
- `assistant/additional-context.md` — additional context file.
- `.env` — environment configuration.

### Runtime Root

`.eberron-query-assistant/` stores all app-owned local state and derived artifacts:
- Persistent runtime state
- Saved generated NPC data
- Retrieval artifacts
- Caches
- Bounded diagnostic logs

### Runtime Subareas

- `.eberron-query-assistant/state/` — persisted runtime state and generated NPC data.
- `.eberron-query-assistant/cache/` — scrape and parse caches.
- `.eberron-query-assistant/cache/keith-baker/` — cached Keith Baker index and article HTML.
- `.eberron-query-assistant/retrieval/` — searchable local corpus and retrieval artifacts.

### Other Artifacts

- `logs/` — persisted standard-assistant transcript logs.
- `.test-tmp/timing.jsonl` — local timing diagnostics.
- `.eberron-query-assistant/provider-debug.jsonl` — bounded debug and provider-diagnostic output (debug mode only).

## Output Artifacts and Persistence

### Standard Transcript Logs

- Stored under `logs/`.
- Session file created lazily after the first successful standard-assistant answer.
- Refresh-only activity does not create transcript files.
- Filenames begin with a timestamp and a human-readable assistant-provided session title.
- Contents preserve ordered question-and-answer exchanges.
- May include persisted standard-mode retrieval progress entries that preceded the final answer.
- Older logs remain browsable from the `Log` tab without becoming the active writable session.

### Generated NPC State

- Stored at `.eberron-query-assistant/state/generated-npcs.json`.
- Authoritative local store for saved NPC cards.
- Distinct from transcript logs; not loaded automatically as prompt memory.

### Runtime State

Tracks enough information to support incremental refresh decisions:
- Last successfully applied Foundry export file or run marker.
- Known PDF inventory.
- Keith Baker article discovery and scrape status.
- Retrieval bookkeeping needed for stale-entry cleanup.

- Updated only after work has completed successfully enough to trust.

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
