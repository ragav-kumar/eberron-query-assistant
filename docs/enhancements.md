# Enhancements

This file records intentional high-level changes on top of the frozen Phase 6 historical baseline. Its purpose is to prevent future sessions from mistaking deliberate changes for unintended divergence.

## Force-Reingest-Only Invalidation

Routine startup preserves valid runtime state, corpus rows, and retrieval artifacts across application version changes. `appVersion` is diagnostic metadata only. The app only clears corpus storage or forces retrieval rebuild when the user explicitly runs force reingest through the supported UI or script.

This intentionally diverges from any older baseline behavior that invalidated state because version metadata changed. Incompatible persisted artifacts should fail clearly and tell the user to run force reingest instead of being silently deleted or rebuilt during routine startup.

Verification added or preserved for this change covers state normalization with old, non-semver, or missing versions; runtime force-rebuild behavior; ingestion reset behavior; and incompatible corpus artifact handling.

## Assistant Prompt Assets And Local Context

Assistant prompt instructions live in tracked Markdown files under `assistant/`. Local-only context lives in `assistant/additional-context.md`, is gitignored, is created empty when missing, and is included in assistant requests only when it contains text.

This file is prompt context, not a retrieval source. It intentionally gives local campaign notes and assistant-only guidance a place outside Foundry, PDFs, and article ingestion.

Verification added or preserved for this change covers prompt path configuration, file-backed system and title prompts, empty and non-empty additional context, and creation of the missing local context file.

## GUI Replacement

The user-facing assistant workflow is now a local React 19 and Vite browser UI launched with `npm run start`. The GUI supports assistant prompts, retrieval debugging, normal refresh, force reingest, active session log rendering, and editing `assistant/additional-context.md`.

This intentionally replaces the old interactive terminal assistant workflow for normal use. The app remains local-only; `logs/` and `assistant/additional-context.md` remain gitignored and are not loaded as future assistant memory.

Verification added or preserved for this change covers package metadata and scripts, server API behavior, React UI behavior, operation busy states, log rendering, and the existing ingestion, retrieval, provider, state, prompt, and runtime boundaries.

## GUI Input And Output Tabs

The browser UI separates left-side inputs from right-side outputs. The left column has `Input` and `Additional Context` tabs; the `Input` tab uses radio buttons for Standard assistant prompts, Debug Query retrieval inspection, and Name Generator mode.

The right column has a transient plain-text `Console` feed for local progress, refresh, debug, warning, and error output, a persisted Markdown `Log` tab for assistant transcript output, and an `NPCs` tab for current-session generated NPC cards. Console output is process-local, is not written to `logs/`, and output panes auto-scroll as new output arrives.

Assistant, name-generator, and debug-query input do not require the user to run refresh manually first. If the current browser-server session has not completed a refresh yet, the app runs a routine refresh automatically before continuing with the requested input. Input panels use unframed layouts rather than cards, and Enter submits the active input mode while Shift+Enter preserves multiline text-area prompts.

Verification added or preserved for this change covers structured console API behavior, transcript separation, tab and radio rendering, autosaved additional context, output auto-scroll, tooltips, and componentized React UI behavior.

## GUI Log Browser And Sessions

The Log tab can browse saved Markdown transcripts from `logs/` with a dropdown. Historical transcripts are read-only display targets; Standard assistant input always writes to the current writable browser-server session, creating one lazily if no current session exists.

The app initially shows an empty Log pane instead of loading an existing transcript automatically. A `New session` button clears the current writable assistant session and conversation history without creating an empty file; the next successful Standard assistant exchange creates the new transcript. Debug Query, Refresh, and Force reingest still do not create transcript files.

Verification added for this change covers safe log-file listing and selection, read-only historical browsing, active-session writes while viewing history, lazy new-session behavior, and React controls for selecting logs and starting sessions.

## Name Generator NPC Cards

Name Generator mode now asks the assistant for structured NPC records with numeric ids, names, physical descriptions, and very short bios. The model infers the requested count from the prompt, uses retrieval evidence and local assistant context for Eberron accuracy, and can revise current-session NPCs by returning an existing id while assigning new NPCs ids above the current maximum.

Generated NPCs render as cards in the right-column `NPCs` tab and are appended to `logs/generated_npcs.md`. This file is write-only from the UI, is excluded from the transcript browser, and is not loaded as future assistant memory. Switching between Standard and Name Generator closes the other in-memory session; `New session` clears the active Standard transcript session or current NPC cards without deleting append-only log files.

Verification added for this change covers structured NPC parsing, id-based card patching, append-only NPC logging, failure behavior, session switching, `New session` behavior, and React rendering for the Name Generator workflow.

## Thin Local Runtime Bridge

The React GUI now owns browser-session state such as selected mode, current prompts, busy display, selected output tab, current NPC cards, and fresh-session identity. The Vite middleware remains only as a local Node bridge for filesystem, retrieval, refresh, provider, and log-reading capabilities that cannot reasonably run in the browser.

This intentionally reduces fake REST-style state polling while preserving the local browser-plus-Node runtime model. Standard and NPC sessions are identified by browser-owned session ids when an operation needs Node runtime work.

Verification added or preserved for this change covers client-owned mode and new-session behavior, the slimmer bridge route surface, operation result output updates, safe log reads, refresh behavior, and server-side operation locking.
