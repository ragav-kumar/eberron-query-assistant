# Repo Rules

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Agent Modes
- Every task operates in exactly one agent mode: `Analysis`, `Development`, `Review`, or `Introspection`.
- `Analysis`: understand current and intended behavior before implementation.
- `Development`: implement behavior changes and run the required acceptance checks.
- `Review`: evaluate changes for bugs, risks, regressions, and missing coverage.
- `Introspection`: create or revise agent-governance rules and workflow instructions only.
- Mode-specific workflow rules live in `docs/agent-modes.md`.
- Use that document to determine mode selection, allowed actions, switching behavior, and mode-specific verification workflow before reading path-specific implementation guidance.
- Path-specific `AGENTS.md` files define local constraints for their areas. Consult them whenever the current task touches that area.

## General Rules
- Do not expand the scope of a task without asking the user first. If you decide scope should expand, stop and ask before making the broader change. This applies even outside plan mode.
- If you ask the user a question, and they provide a custom option which is either a question or a request for more information, prioritize responding to that.
- Work against the current branch unless later repo instructions explicitly say otherwise.
- If you consult any historical V1 materials, explicitly disclose it to the user and name the file or files plus the compatibility reason.

## Repo Invariants
- Keep `README.md` focused on setup, configuration, inputs, operation, and expectations for end users. Do not update `README.md` unless the user explicitly requested the documentation change or clearly suggested the change being made.
