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

The browser UI separates left-side inputs from right-side outputs. The left column has `Input` and `Additional Context` tabs; the `Input` tab uses radio buttons for Standard assistant prompts, Debug Query retrieval inspection, and a stubbed Name Generator mode.

The right column has a transient plain-text `Console` feed for local progress, refresh, debug, warning, and error output, plus a persisted Markdown `Log` tab for assistant transcript output. Console output is process-local, is not written to `logs/`, and both Console and Log auto-scroll as new output arrives.

Verification added or preserved for this change covers structured console API behavior, transcript separation, tab and radio rendering, autosaved additional context, output auto-scroll, tooltips, and componentized React UI behavior.
