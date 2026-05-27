# Documentation rules

## Scope
- These rules apply to documentation under `/docs`.
- This file is primarily relevant during `Analysis` and `Introspection`.

## Docs Structure
- Treat `docs/SPEC.md` as the single authoritative specification for product behavior and requirements. Consult it first when preparing for any implementation or review task.
- Treat `docs/agent-modes.md` as the single source of truth for mode behavior unless it becomes hard to scan or meaningfully unbalanced.
- If `docs/agent-modes.md` grows enough that one mode dominates it, mode-specific examples or edge cases accumulate substantially, or routine edits start touching only one mode section, warn the user that it is time to consider splitting the mode doc.

## Documentation Changes
- Do not update files under `/docs` outside `Analysis` or `Introspection`.
- Files under `/docs` whose primary purpose is agent governance, workflow, permissions, or verification rules, including `docs/agent-modes.md`, may only be updated in `Introspection`.
- Within `Analysis`, only update non-agent documentation under `/docs` when the user explicitly requested the documentation change or clearly suggested the change being made.
