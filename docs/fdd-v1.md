# Eberron Query Assistant Functional Design Document

## Executive Summary

Eberron Query Assistant is a local application for querying and synthesizing information from an Eberron campaign corpus. It combines three kinds of source material into one searchable knowledge base:

- Foundry world export data
- a local PDF library
- Keith Baker articles discovered from the Eberron article index

The application presents a browser-based interface for two main workflows:

- a standard assistant workflow for lore, campaign, and reasoning questions
- an NPC generation workflow for producing and revising structured NPC cards

The product is designed around repeatable local refresh behavior. It keeps durable local runtime state, transcripts, caches, and generated NPC data on disk, while keeping active conversation memory limited to the current session. It should prefer grounded answers with citations when possible, support both direct lookup and synthesis across sources, and fail clearly when the local corpus is unavailable.

This document describes the intended user-facing behavior, information architecture, local data conventions, and operational rules closely enough that the application could be recreated in another language or framework without relying on this repository's implementation details.

## Table of Contents

1. [Product Purpose](#product-purpose)
2. [Supported Inputs and Source Material](#supported-inputs-and-source-material)
3. [Environment Configuration](#environment-configuration)
4. [User Interface Overview](#user-interface-overview)
5. [Main Workflows](#main-workflows)
6. [Retrieval and Answer Behavior](#retrieval-and-answer-behavior)
7. [NPC Generation Behavior](#npc-generation-behavior)
8. [Additional Context Behavior](#additional-context-behavior)
9. [Runtime Data and Local File Locations](#runtime-data-and-local-file-locations)
10. [Output Artifacts and Persistence](#output-artifacts-and-persistence)
11. [Failure, Degraded, and Recovery Behavior](#failure-degraded-and-recovery-behavior)
12. [User Expectations and Constraints](#user-expectations-and-constraints)

## Product Purpose

The application exists to help a user ask questions against an Eberron corpus that mixes official or campaign-authored material with locally curated sources. It should support:

- direct lore lookup
- campaign-specific lookup against Foundry-exported records
- questions that compare or combine multiple sources
- inference-heavy questions that require synthesis rather than quotation
- lore-aware NPC generation and revision

The product is local-first. A user is expected to keep source files in conventional project folders, open the app locally, refresh the corpus as needed, and work with the resulting answers, logs, and generated NPC cards on the same machine.

The assistant must not treat prior transcripts or saved NPC state as future conversation memory unless that information is explicitly provided again through current runtime context. Saved artifacts are for user review and continuity, not silent background memory.

## Supported Inputs and Source Material

The application uses three primary source classes.

### Foundry Export Data

Foundry data is expected in a `foundry-export/` folder containing one or more NDJSON export files that represent retained export history.

The folder is treated as an ordered local export history rather than a single current snapshot file. Each export file is an NDJSON stream that begins with export-run metadata and then carries record-level change entries. Those change entries may add, update, or delete Foundry-derived records.

The only required file-level assertion for Foundry export history is that the inputs are NDJSON export files. Valid export histories must preserve chronological order lexicographically in filenames so the file set remains inspectable and naturally sortable on disk. Routine refresh should apply only export files that have not yet been successfully incorporated, using that lexicographic file order as the export-history order. Force reingest should be able to rebuild the current Foundry-backed corpus by replaying the retained export history.

Foundry content is used for campaign-specific entities such as actors, journals, locations, organizations, and other world records.

Foundry-derived information should preserve enough source identity to support meaningful citations, including the entity name and entity kind where available.

### Local PDF Library

PDF files are expected in a `pdf/` folder. Each PDF is treated as a source document in the knowledge base. The application should preserve enough information to cite the document clearly, usually by title or filename and page context when available.

Unchanged PDFs are expected to remain stable. The app should recognize newly added files, remove deleted ones from the corpus, and avoid unnecessary reprocessing of unchanged PDFs during routine refresh.

### Keith Baker Articles

Keith Baker articles are discovered from the Eberron article index and then ingested as a third source class. These articles should be treated as structured long-form web content with persistent source identity, including title and URL.

The application should maintain local article caching behavior so a full rebuild can often reuse previously captured raw article content instead of re-fetching every page.

Responses that are permanently inaccessible at the source, such as article pages that consistently return "not found" or forbidden access responses, should be recorded and skipped on later runs rather than retried indefinitely.

## Environment Configuration

The application uses a local environment file for configuration. The exact loading mechanism is not important to the design; what matters is that the app reads named configuration values before performing refresh, retrieval, and answer generation.

The environment file serves three purposes:

- provider configuration for the external AI service
- party-context configuration for campaign-aware prompts
- optional diagnostics and debugging controls

### Provider Settings

The application reads the following provider-related settings:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL`

Functional meaning:

- `OPENAI_API_KEY` supplies credentials for the model provider.
- `OPENAI_BASE_URL` identifies the provider base address. This allows the app to work with compatible provider deployments rather than assuming a single hosted endpoint.
- `OPENAI_CHAT_MODEL` selects the model used for assistant and NPC responses.
- `OPENAI_EMBEDDING_MODEL` selects the model used for retrieval embeddings.

Default behavior:

- `OPENAI_API_KEY` is required for provider-backed assistant and NPC operations.
- `OPENAI_BASE_URL` has a built-in default.
- `OPENAI_CHAT_MODEL` has a built-in default.
- `OPENAI_EMBEDDING_MODEL` has a built-in default.

If the API key is missing or provider settings are otherwise invalid, refresh may still inspect local files, but assistant-style operations that require model access should fail clearly instead of producing misleading output.

### Optional Party-Context Settings

The following settings are optional and control automatic inclusion of current-party information:

- `EQA_PARTY_ACTOR_UUIDS`
- `EQA_SESSION_NOTES_JOURNAL`
- `EQA_QUESTS_JOURNAL`
- `EQA_CAMPAIGN_JOURNAL_FOLDER`

Functional meaning:

- `EQA_PARTY_ACTOR_UUIDS` identifies which party members should be treated as the active party.
- `EQA_SESSION_NOTES_JOURNAL` identifies the journal that records what has happened in play.
- `EQA_QUESTS_JOURNAL` identifies the journal that tracks active or expected quest threads.
- `EQA_CAMPAIGN_JOURNAL_FOLDER` identifies the campaign journal grouping convention used when collecting broader campaign context.

If these settings are absent, incomplete, or refer to missing Foundry content, the app should continue to work. It should omit unavailable party context, report the limitation when useful, and avoid turning a party-context gap into a full application failure.

### Optional Diagnostic Setting

The following setting is optional:

- `EQA_PROVIDER_DEBUG`

When enabled, it allows the app to surface raw provider diagnostics in local debug output and in a bounded local diagnostic log. This mode is intended for troubleshooting. It should remain off by default because diagnostic payloads can contain full prompt context and retrieved evidence.

Even in debug mode, the application should never record authorization headers or API keys in its saved diagnostic output.

## User Interface Overview

The application opens a local browser interface organized into two vertical columns.

### Left Column

The left column is the input side of the application. It contains:

- a header area with refresh controls and refresh status
- an `Input` tab
- an `Additional Context` tab

The refresh controls allow the user to:

- run a routine refresh
- run force reingest
- understand whether the last refresh succeeded, failed, or is still running

The `Input` tab contains the active prompt workflow controls:

- a shared `Include party info` toggle
- a shared `Extra retrieval turns` control with range `0` to `3`
- a mode selector with `Standard` and `NPC Generator`
- a prompt entry area for the active mode

The `Additional Context` tab contains an editor for local, assistant-only notes. This panel is for user-authored guidance that should influence prompts but should not be ingested as corpus content.

### Right Column

The right column is the output side of the application. It contains three tabs:

- `Console`
- `Log`
- `NPCs`

The `Console` tab shows transient operational output. It is used for local progress, refresh messages, warnings, errors, and optional diagnostics.

The `Log` tab shows persisted standard-assistant transcript output. It supports browsing saved sessions and viewing each session as a structured sequence of question-and-answer sections with a table of contents.

The `NPCs` tab shows saved NPC cards produced by the NPC generator workflow. Cards are displayed in a space-aware tiled layout when the pane is wide enough.

### Interaction Rules

The UI should support the following interaction conventions:

- pressing Enter submits the active prompt
- pressing Shift+Enter inserts a new line in text entry areas
- inputs remain visible until a request succeeds
- output panes follow new output as it arrives
- long-running operations visibly lock overlapping actions so the user cannot start conflicting work at the same time

## Main Workflows

### Startup Refresh

The application performs one routine refresh when the interface first connects to the local runtime. This refresh checks source state, updates the corpus only where needed, and blocks overlapping assistant or NPC work until it finishes or fails.

The startup refresh should:

- inspect the current Foundry export
- inspect the current PDF directory
- inspect Keith Baker article discovery state
- reuse unchanged local state when possible
- skip retrieval maintenance entirely when discovery and ingestion found no changes

For Foundry specifically, startup refresh should look for unapplied export files and apply only those files. If no new export files are present, Foundry work should be skipped.

If startup refresh fails, the user should be able to retry by submitting a prompt later or by triggering a manual refresh.

### Routine Refresh

Routine refresh is an explicit user action for checking sources and updating the local corpus only where needed. It should preserve existing good state, skip unchanged work, and keep users informed through the Console.

Routine refresh should not discard app-owned corpus or retrieval artifacts simply because the app restarted or because metadata changed. It is an incremental maintenance action, not a destructive rebuild.

### Force Reingest

Force reingest is the explicit full rebuild action. It is intended for cases where the user wants to discard and rebuild app-owned corpus and retrieval artifacts from source material.

Force reingest should:

- bypass normal incremental skip logic
- rebuild corpus and retrieval artifacts from source material
- replay the retained Foundry export history needed to reconstruct the current Foundry-backed corpus
- refresh article-derived content using cached raw content where available
- clearly communicate that a full rebuild is occurring

Because this action is intentionally destructive to derived local artifacts, it should require explicit user confirmation.

### Standard Assistant Workflow

In standard mode, the user asks a free-form question about setting lore, campaign facts, cross-source relationships, or inference-heavy topics. The app gathers evidence from the corpus, optionally enriches that evidence with party context, and returns an answer intended for direct reading.

This workflow writes persisted transcript output to the current writable session in the `Log` tab.

### NPC Generator Workflow

In NPC Generator mode, the user requests one or more NPCs or revises existing saved NPCs. The app uses the same underlying corpus and optional party context, but the final output must conform to a structured NPC-card shape before it is saved.

This workflow writes saved NPC cards to runtime state and displays them in the `NPCs` tab.

## Retrieval and Answer Behavior

The application should maintain one combined retrieval corpus spanning all supported source classes. Retrieval should support both direct fact lookup and broader synthesis.

### Initial Retrieval Pass

Every assistant-style request begins with an initial retrieval pass over the corpus. This pass should provide enough evidence for straightforward questions and should anchor inference-heavy responses in retrieved material.

### Extra Retrieval Turns

The `Extra retrieval turns` control determines how many additional targeted retrieval passes the model may request after the initial retrieval pass.

Rules:

- allowed range is `0` to `3`
- default value is `1`
- `0` still allows the initial retrieval pass but prevents additional targeted retrieval
- the same limit applies to both Standard and NPC Generator workflows

This mechanism exists to improve difficult answers without allowing uncontrolled looping.

### Citation Expectations

Answers should provide references whenever supporting evidence is available.

Expected citation styles:

- for PDFs: document title or filename with page context when available
- for Keith Baker articles: article title and URL
- for Foundry-derived content: entity name and entity type when available

The assistant should distinguish quoted or directly supported claims from synthesis. Inference-heavy answers must not present a synthesized conclusion as though it were a direct quotation from one source.

### Follow-Up Progress Reporting

When the standard assistant workflow uses extra retrieval turns, short progress notes should be written into the active transcript before the final answer.

When the NPC Generator workflow uses extra retrieval turns, intermediate progress should stay in the transient Console instead of being saved as part of the NPC record set.

## NPC Generation Behavior

NPC generation produces structured saved cards rather than plain prose blobs.

Each NPC card should include:

- a numeric identifier
- a name
- a physical description
- a very short biography

Cards may also include knowable details such as:

- species
- ethnicity
- gender
- role
- approximate age

The workflow should infer how many NPCs are requested from the prompt itself.

### Revision Rules

The user may revise an existing saved NPC instead of only creating new ones.

Rules:

- if the model returns an existing numeric identifier, that NPC card is updated in place
- new cards must use identifiers above the current maximum saved identifier
- invalid final structured output must not overwrite saved NPC state

The product may use a repair attempt for malformed structured output, but if the result still fails validation, the request should fail clearly and leave previously saved NPC data unchanged.

### Display Rules

Saved NPCs remain browsable independently of the current prompt session. The `NPCs` tab should always render the saved card collection from runtime state, sorted with the newest updates first.

Switching between prompt modes should not delete persisted NPC cards.

## Additional Context Behavior

Additional Context is local prompt guidance authored by the user. It is not part of the retrieval corpus and should not be cited as though it were a source document.

Its purpose is to let the user store campaign notes, style guidance, local assumptions, or other assistant-only instructions outside Foundry exports, PDFs, and articles.

Behavior rules:

- the file is created empty if it does not yet exist
- it is included in prompts only when it contains text
- it is editable in-app
- it is local-only and not treated as transcript memory

This feature should remain clearly separate from source ingestion so the user can distinguish between cited corpus evidence and uncited local guidance.

## Runtime Data and Local File Locations

The application relies on conventional repo-local folders and files.

### Source Locations

- `foundry-export/`
- `pdf/`
- `assistant/additional-context.md`
- `.env`

Within `foundry-export/`, the expected inputs are NDJSON export files. Their application order is determined by lexicographic filename order, which is required to match export chronology.

### Runtime Root

The main runtime root is `.eberron-query-assistant/`.

This area stores app-owned local state and derived artifacts, including:

- persistent runtime state
- saved generated NPC data
- retrieval artifacts
- caches
- bounded diagnostic logs

### Expected Runtime Subareas

- `.eberron-query-assistant/state/` for persisted runtime state and generated NPC data
- `.eberron-query-assistant/cache/` for scrape and parse caches
- `.eberron-query-assistant/cache/keith-baker/` for cached Keith Baker index and article HTML
- `.eberron-query-assistant/retrieval/` for the searchable local corpus and retrieval artifacts

### Other Local Artifacts

- `logs/` for persisted standard-assistant transcript logs
- `.test-tmp/timing.jsonl` for local timing diagnostics
- `.eberron-query-assistant/provider-debug.jsonl` for bounded debug and provider-diagnostic output when debug mode is enabled

The design assumes these locations are local operational storage, not shareable product content.

## Output Artifacts and Persistence

### Standard Transcript Logs

Standard assistant activity is persisted under `logs/`.

Behavior rules:

- a session file is created lazily after the first successful standard-assistant answer
- refresh-only activity does not create transcript files
- transcript filenames begin with a timestamp and a human-readable assistant-provided session title
- transcript contents preserve ordered question-and-answer exchanges
- transcript contents may also include persisted standard-mode retrieval progress entries that occurred before the final answer

Historical logs should remain readable, and older logs should be browsable from the `Log` tab without becoming the active writable session.

### Generated NPC State

Generated NPC cards are saved under `.eberron-query-assistant/state/generated-npcs.json`.

This file is the authoritative local store for saved NPC cards. It is distinct from transcript logs and is not loaded automatically as prompt memory.

### Runtime State

The application maintains local runtime state that supports incremental refresh decisions and operational continuity. This state should include enough information to track:

- the last successfully applied Foundry export file or run marker
- known PDF inventory
- Keith Baker article discovery and scrape status
- retrieval bookkeeping needed for stale-entry cleanup

This state should be updated only after work has completed successfully enough to trust.

## Failure, Degraded, and Recovery Behavior

The app should be resilient to partial failures.

### Source-Scoped Failure Handling

Failure in one source pipeline should not automatically invalidate all others. If at least one source class remains usable, the app may continue in degraded mode after clearly naming the affected source type.

Examples:

- article discovery failure while Foundry and PDFs remain usable
- missing party-context journals while the broader corpus remains usable
- one source class partially refreshed while others remained current

### Empty-Corpus Failure

If no usable retrieval corpus can be produced, the application must fail clearly instead of pretending it can answer reliably.

### Safe State Advancement

The app must not mark incomplete work as current. Persisted state should advance only after ingestion and retrieval outputs are in a trustworthy condition.

If refresh fails after partial work, the previous trusted state should remain available so the next run can retry safely.

### Reconnect Recovery

If the interface reloads or reconnects while the same local runtime process is still alive, the app should restore:

- the current in-process operation status
- the transient Console feed accumulated so far

If the local runtime process itself stops, that transient recovery state is intentionally lost.

## User Expectations and Constraints

The intended user experience has the following constraints.

### What the User Can Expect

- a local browser interface focused on querying and generating against a local corpus
- incremental refresh behavior that avoids unnecessary reprocessing
- explicit force reingest when a full rebuild is desired
- grounded answers with useful citations when supporting evidence exists
- support for both direct questions and synthesis-heavy questions
- durable local transcript and NPC-card persistence without hidden cross-session memory

### What the App Should Not Do

- silently use old transcripts as future prompt memory
- silently clear app-owned corpus artifacts during routine startup
- treat local Additional Context as cited retrieval evidence
- present unsupported inference as though it were directly sourced
- overwrite saved NPC cards with invalid structured output

### Assumptions About Source Material

- the `foundry-export/` folder is a retained chronological history of NDJSON export files
- each Foundry NDJSON export file contains export metadata plus record-level add, update, or delete operations
- PDF identity is filename-based for routine change detection
- Keith Baker article discovery is based on the Eberron index and may rely on local caching to reduce repeat fetching

### Reimplementation Guidance

A reimplementation should preserve these product-level invariants even if the internal architecture changes:

- the same source-folder conventions
- the same distinction between routine refresh and force reingest
- the same UI layout and workflow split
- the same separation between transient Console output, persisted transcript logs, and persisted NPC cards
- the same environment-driven configuration model
- the same rule that local prompt context and saved logs are not equivalent to retrieval corpus evidence
