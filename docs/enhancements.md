# Enhancements

This file records intentional high-level changes on top of the frozen Phase 6 historical baseline. Its purpose is to prevent future sessions from mistaking deliberate changes for unintended divergence.

## Capped Provider Debug Log

Setting `EQA_PROVIDER_DEBUG=true` still returns provider diagnostics to the browser, but those diagnostics are now also written as JSON lines into a bounded runtime log at `.eberron-query-assistant/provider-debug.jsonl`. The file keeps only the newest entries up to its configured line cap and drops older lines from the top as new diagnostics arrive.

The same file also mirrors local Console/debug progress entries, including startup refresh flow, so long-running or stalled requests can be correlated with what the local runtime was doing before any provider call happened. Provider diagnostics are now mirrored through that same server-side Console stream instead of a separate client-only browser `console.debug(...)` path.

This keeps raw provider request and response diagnostics available after a stalled or failed browser interaction without mixing them into transcript logs. Authorization headers and API keys remain excluded from the captured diagnostic payloads.

Verification added for this change covers disabled-by-default disk behavior, enabled app-level file writing, and low-cap line trimming behavior.

## Request Timing Diagnostics And Mini Default

The default OpenAI chat model is `gpt-5.4-mini` to favor faster routine assistant responses while preserving an override through `OPENAI_CHAT_MODEL`.

Assistant, NPC generation, refresh, retrieval, chat, party-context, state, and transcript-log timing spans are written as JSON lines to `.test-tmp/timing.jsonl`. This diagnostic file is gitignored and exists to make slow local requests analyzable after a run without saving timing data into user transcripts.

Verification added for this change covers the model default and structured timing output for assistant operations.

## Assistant And NPC Retrieval Tools

Standard assistant mode keeps the existing first retrieval pass and can optionally make a bounded number of additional local corpus searches through a native `search_corpus` provider tool. NPC Generator mode now uses the same bounded tool loop and the same shared `Extra retrieval turns` slider with range `0` to `3` and default `1`.

When Standard mode uses follow-up retrieval, concise progress text is written into the active transcript log before the final answer. Transcript JSON now stores a mixed ordered list of final Q&A exchanges and persisted progress entries, while historical exchange-only logs remain readable without migration.

When NPC Generator mode uses follow-up retrieval, progress text goes only to the transient Console stream. Final NPC output still has to parse as strict JSON before any saved NPC state is updated, and one provider-driven JSON-only repair pass is allowed before the request fails.

Verification added for this change covers provider tool-call payloads, Standard assistant tool-loop behavior, NPC Generator tool-loop behavior, persisted Standard progress log ordering, Console-only NPC progress, selected turn limits for both workflows, and strict NPC JSON repair and failure handling.

## Readable Session Titles

Assistant transcript session titles are requested as normal human-readable phrases with spaces instead of machine-style kebab-case, snake_case, PascalCase, or camelCase. Transcript filename sanitization also repairs those common machine-case forms before creating the JSON log file.

Verification added for this change covers prompt instructions and session-title sanitization.

## Opt-In Provider Debug Console

Setting `EQA_PROVIDER_DEBUG=true` enables local raw chat diagnostics for Standard assistant and NPC Generator provider calls. When enabled, each completed chat call still returns its raw provider request body, raw JSON response body when available, extracted assistant content, status, endpoint, and operation metadata to the browser, and the server now emits the same diagnostic payload into the app Console/debug stream.

This diagnostic path is off by default because request bodies can include full prompt context, retrieved evidence, and local assistant notes. It never includes authorization headers or API keys, is not saved to transcript logs, is not replayed through status recovery, and is mirrored into the bounded runtime log described above through the same server-side Console path the browser UI reads.

Verification added for this change covers the config flag, provider diagnostic capture, disabled-by-default server responses, enabled assistant and NPC operation diagnostics, and server-side Console mirroring.

## Startup Retrieval Refresh Skip

Routine startup refresh now skips retrieval-index refresh entirely when discovery and ingestion both found no source changes and the run is not a force reingest. This preserves the existing explicit force-rebuild path while avoiding expensive retrieval maintenance work on unchanged corpora during app startup.

Verification added for this change covers skipped retrieval refresh on unchanged startup runs and preserved force-reingest rebuild behavior.

## Retrieval Vector Cache

Compatible SQLite vector rows are cached in memory per retrieval service instance after successful refresh or first search load. Subsequent searches with the same corpus database path, embedding model, and embedding schema reuse the parsed vectors instead of reading and JSON-parsing every compatible vector row from SQLite.

Routine refresh and force reingest clear and repopulate the cache through the existing retrieval sync path, preserving refresh semantics, force-rebuild behavior, retrieval scoring, and timing labels.

## Browser-Load Startup Refresh

The local web app starts one routine refresh in the background when the browser first connects to the API. The UI reports `startup-refresh` as the active operation while it runs, streams normal Console output, and prevents overlapping assistant, NPC, refresh, or force-reingest work until startup refresh finishes.

If startup refresh fails, the Console records the failure, active-operation state clears, and the next prompt or manual refresh can retry the same routine refresh path. Force reingest remains explicit-only.

Verification added for this change covers startup refresh status, busy rejection during startup refresh, retry after startup refresh failure, avoiding redundant first-prompt refresh, and client display of startup refresh state.

## Cached Party Context

The web runtime caches assembled party context after the first Standard or NPC Generator prompt that includes party info. Routine refresh and force reingest clear the cache so later prompts rebuild party context from the latest corpus.

Verification added for this change covers cache reuse across Standard and NPC workflows and cache invalidation after refresh.

## Operation Reconnect Recovery

The browser UI now restores current in-process operation status after a reload or reconnect to the same local Vite server. Runtime artifact directories are excluded from Vite file watching so force reingest writes do not trigger dev-server reloads, and the transient Console feed replays existing in-memory entries before streaming new ones.

Console output remains process-local and is not written to transcript logs. If the local server process is stopped or restarted, active-operation and Console recovery state is intentionally lost.

## Force-Reingest-Only Invalidation

Routine startup preserves valid runtime state, corpus rows, and retrieval artifacts across application version changes. `appVersion` is diagnostic metadata only. The app only clears corpus storage or forces retrieval rebuild when the user explicitly runs force reingest through the supported UI or script.

This intentionally diverges from any older baseline behavior that invalidated state because version metadata changed. Incompatible persisted artifacts should fail clearly and tell the user to run force reingest instead of being silently deleted or rebuilt during routine startup.

Verification added or preserved for this change covers state normalization with old, non-semver, or missing versions; runtime force-rebuild behavior; ingestion reset behavior; and incompatible corpus artifact handling.

## Keith Baker Raw HTML Cache

Keith Baker index and article HTML is cached under `.eberron-query-assistant/cache/keith-baker/`. Force reingest rebuilds article corpus rows from cached raw article HTML when available, so schema, chunking, or citation changes do not require refetching every article page.

Routine article refresh still checks the live index on the configured cadence and populates missing raw page cache entries as needed. During force reingest, a missing cached article page is fetched and cached; permanently inaccessible 403/404 pages remain excluded from retries. To force a complete redownload, delete the Keith Baker cache directory before running force reingest.

Verification added for this change covers raw cache writes, force-reingest cache hits, cache misses, cached-index fallback during force reingest, failed-page cache avoidance, and preserved inaccessible-page handling.

## Assistant Prompt Assets And Local Context

Assistant prompt instructions live in tracked Markdown files under `assistant/`. Local-only context lives in `assistant/additional-context.md`, is gitignored, is created empty when missing, and is included in assistant requests only when it contains text.

This file is prompt context, not a retrieval source. It intentionally gives local campaign notes and assistant-only guidance a place outside Foundry, PDFs, and article ingestion.

Verification added or preserved for this change covers prompt path configuration, file-backed system and title prompts, empty and non-empty additional context, and creation of the missing local context file.

## NPC Generator Prompt Asset

NPC Generator model instructions now live in `assistant/npc-generator-prompt.md` instead of source-code string literals. Runtime code still assembles that prompt asset with retrieved evidence, saved NPC state, the current user prompt, and the current maximum saved NPC id.

Durable repo guidance now requires reusable model prompt instructions to live in tracked `assistant/` Markdown files as much as is reasonable. Verification covers prompt path configuration, prompt asset loading, and NPC generation behavior through the existing server and client workflows.

## GUI Replacement

The user-facing assistant workflow is now a local React 19 and Vite browser UI launched with `npm run start`. The GUI supports assistant prompts, normal refresh, force reingest, active session log rendering, and editing `assistant/additional-context.md`.

This intentionally removes the old interactive terminal assistant workflow. The app remains local-only; `logs/` and `assistant/additional-context.md` remain gitignored and are not loaded as future assistant memory.

Verification added or preserved for this change covers package metadata and scripts, server API behavior, React UI behavior, operation busy states, log rendering, and the existing ingestion, retrieval, provider, state, prompt, and runtime boundaries.

## GUI Input And Output Tabs

The browser UI separates left-side inputs from right-side outputs. The left column has `Input` and `Additional Context` tabs; the `Input` tab uses radio buttons for Standard assistant prompts and NPC Generator mode.

The right column has a transient plain-text `Console` feed for local progress, refresh, debug, warning, and error output, a persisted Markdown `Log` tab for assistant transcript output, and an `NPCs` tab for saved generated NPC cards. Console output is process-local, is not written to `logs/`, and output panes auto-scroll as new output arrives.

Assistant and NPC generator input do not require the user to run refresh manually first. If the current browser-server session has not completed a refresh yet, the app runs a routine refresh automatically before continuing with the requested input. Input panels use unframed layouts rather than cards, and Enter submits the active input mode while Shift+Enter preserves multiline text-area prompts.

Verification added or preserved for this change covers structured console API behavior, transcript separation, tab and radio rendering, autosaved additional context, output auto-scroll, tooltips, and componentized React UI behavior.

## GUI Log Browser And Sessions

The Log tab can browse saved transcripts from `logs/` with a dropdown. Historical transcripts are read-only display targets; Standard assistant input always writes to the current writable browser-server session, creating one lazily if no current session exists.

The app initially shows an empty Log pane instead of loading an existing transcript automatically. A `New session` button clears the current writable assistant session and conversation history without creating an empty file; the next successful Standard assistant exchange creates the new transcript. Refresh and Force reingest still do not create transcript files.

## GUI Debug Query Removal

The browser UI no longer includes the Debug Query retrieval-inspection mode or its local web API route. The leftover terminal retrieval-debug runtime path has also been removed, so retrieval inspection is no longer exposed as a user-facing or npm-script workflow.

Verification updated for this change removes GUI debug-query and terminal runtime assertions while preserving Standard assistant, NPC Generator, refresh, Console, and log-browser coverage.

Verification added for this change covers safe log-file listing and selection, read-only historical browsing, active-session writes while viewing history, lazy new-session behavior, and React controls for selecting logs and starting sessions.

## NPC Generator Cards

NPC Generator mode now asks the assistant for structured NPC records with numeric ids, names, physical descriptions, and very short bios. The model infers the requested count from the prompt, uses retrieval evidence and local assistant context for Eberron accuracy, and can revise saved NPCs by returning an existing id while assigning new NPCs ids above the current maximum.

Generated NPCs render as cards in the right-column `NPCs` tab and are saved as local runtime state in `.eberron-query-assistant/state/generated-npcs.json`. This state is excluded from transcript browsing and is not loaded as future assistant memory. Switching between Standard and NPC Generator closes the other in-memory session; `New session` clears the active Standard transcript session or resets NPC generation context without deleting saved NPC cards.

Verification added for this change covers structured NPC parsing, id-based card patching, NPC persistence failure behavior, session switching, `New session` behavior, and React rendering for the NPC Generator workflow.

## Persistent NPC Browsing

The `NPCs` tab now always renders saved generated NPC cards from runtime state, sorted newest to oldest. NPC state is stored as a JSON array at `.eberron-query-assistant/state/generated-npcs.json`; each record includes its numeric id, card text, creation timestamp, and update timestamp.

NPC Generator responses that return an existing id update that saved NPC card instead of appending a duplicate revision. Responses that return new ids must still assign ids above the saved maximum. Legacy local `logs/generated_npcs.md` files are migrated into JSON state only when the JSON state file does not already exist, and malformed or duplicate legacy/state records fail clearly.

Verification added for this change covers missing state, JSON loading and validation, newest-first rendering, generation inserts and revisions, legacy Markdown migration, and preserving saved cards across Standard prompts, mode switches, and NPC generation-context resets.

## Thin Local Runtime Bridge

The React GUI now owns browser-session state such as selected mode, current prompts, busy display, selected output tab, rendered NPC cards, and fresh-session identity. The Vite middleware remains only as a local Node bridge for filesystem, retrieval, refresh, provider, and log-reading capabilities that cannot reasonably run in the browser.

This intentionally reduces fake REST-style state polling while preserving the local browser-plus-Node runtime model. Standard and NPC sessions are identified by browser-owned session ids when an operation needs Node runtime work.

Verification added or preserved for this change covers client-owned mode and new-session behavior, the slimmer bridge route surface, operation result output updates, safe log reads, refresh behavior, and server-side operation locking.

## GUI Operation Responsiveness Fixes

The browser UI streams local Console entries while operations are still running, keeps submitted Standard and NPC Generator text visible until a request succeeds, and creates Standard transcript filenames from assistant-provided title metadata. New Standard transcripts must not use `GUI Session` or the submitted question as fallback filenames; if a session title is omitted but a response title is present, the response title is used, and missing title metadata fails clearly.

Verification added for this change covers streamed console subscriptions, prompt clearing success and failure behavior, assistant-title transcript filenames, and fallback transcript filename behavior.

## GUI Output Polish

The right-column tab bar now shows a discreet loading spinner while an operation is running. NPC cards in the `NPCs` tab wrap into multiple columns when space allows, with each card capped around 500 pixels wide so wide output panes can show tiled cards instead of one long column.

Verification added for this change covers the right-column loading indicator during busy operations.

## Automatic Party Context

Standard assistant prompts now include an automatically assembled party context block from the Foundry corpus. Local `.env` settings identify the party actor UUIDs, the Session Notes journal, the Quests journal, and the campaign journal folder convention. This moves routine party identity and current-status lookup out of `assistant/additional-context.md` and into deterministic runtime context.

Session Notes are treated as authoritative for events that happened in play. Quests are treated as authoritative for active or expected quest threads. Actor-sheet mechanics describe the sheet, while actor backstory describes what the character believes happened and may reflect player error, incomplete knowledge, or unreliable narration.

This change depends on richer Foundry metadata preservation during ingestion, including source UUIDs, provenance paths, classification tags, timestamps, and citation anchors. Existing corpus rows created before this enhancement do not contain enough metadata; the user must run force reingest after implementation.

Verification added for this change covers environment config, Foundry metadata ingestion, party-context assembly, degraded missing-source notes, and Standard prompt injection.

## Rich NPC Card Details

NPC Generator cards now support structured species, ethnicity, gender, role, and age details in addition to name, physical description, and bio. The assistant is instructed to provide those details when they apply and are knowable in-setting, while omitting details that do not apply or cannot reasonably be known.

Existing generated NPC state remains valid without migration. Verification added for this change covers legacy saved cards, optional detail normalization and validation, persistence, id-based revisions, and React card metadata rendering.

## JSON Transcript Logs

Standard assistant transcript logs are now JSON files under `logs/` named from the timestamp and assistant-provided session title. Each file stores an array of `{ user, assistant, title }` exchanges. The exchange title is a concise table-of-contents heading for the user prompt; the assistant field remains Markdown answer text.

The Log tab renders a linked table of contents from exchange titles and displays each Q&A pair as a separated section. Existing local Markdown transcript files were converted once into JSON logs, with generic `GUI Session` filenames replaced by better inferred session titles. Legacy `logs/generated_npcs.md` is obsolete because generated NPCs live in JSON state; it is not recreated or browsed as a Standard transcript.

The Log tab dropdown displays saved transcript names without the `.json` extension. Timestamped transcript filenames are shown with a readable date and time followed by the session title, while selection still uses the original file path internally.

## Shared Party Context Toggle

The Input tab now has one shared `Include party info` checkbox above the Standard and NPC Generator mode selector. It is enabled by default and applies to whichever mode is submitted. When unchecked, automatic party context is omitted and the assistant is instructed to treat the request as world querying or world building rather than current-party status.

NPC Generator prompts can now receive the same automatic party context as Standard prompts when the shared checkbox is enabled. Verification added for this change covers prompt assembly, server request options, and React checkbox submission behavior.
