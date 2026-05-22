# Documentation Rules

## Scope
- These rules apply to documentation under `/docs`.
- This file is primarily relevant during `Analysis` and `Introspection`.

## Docs Structure
- Treat `docs/fdd-v1.md` as the intended design for V1.
- Treat `docs/fdd-v2.md` as the intended design for V2.
- Treat `docs/fdd-v1.md`, `docs/known-v1-bugs.md`, and `docs/v1-legacy-reference.md` as acceptable V1-era references for product behavior and migration compatibility.
- No repo-local V1 implementation remains in this repository.
- Do not treat removed, archived, or external historical V1 implementation as a normal documentation source for V2 decisions.
- Keep each versioned design doc focused on the theoretical intended behavior and requirements for that version.
- Keep versioned design docs aligned with intended behavior, including documentation rules established through direct user discussion, rather than with known implementation bugs.
- Treat `docs/agent-modes.md` as the single source of truth for mode behavior unless it becomes hard to scan or meaningfully unbalanced.
- If `docs/agent-modes.md` grows enough that one mode dominates it, mode-specific examples or edge cases accumulate substantially, or routine edits start touching only one mode section, warn the user that it is time to consider splitting the mode doc.

## Documentation Changes
- Do not update files under `/docs` outside `Analysis` or `Introspection`.
- Files under `/docs` whose primary purpose is agent governance, workflow, permissions, or verification rules, including `docs/agent-modes.md`, may only be updated in `Introspection`.
- Within `Analysis`, only update non-agent documentation under `/docs` when the user explicitly requested the documentation change or clearly suggested the change being made.
