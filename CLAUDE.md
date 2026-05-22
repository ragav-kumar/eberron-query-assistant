# Repo Rules

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

@docs/agent-modes.md

## Code Style
- Non-trivial generated code should include JSDoc explaining what it does and, where relevant, why it works that way. This overrides the default no-comments preference for this project.
- This JSDoc expectation does not apply to trivial layout components, styles, or small helper functions unless their behavior would otherwise be unclear.

## General Rules
- Do not expand the scope of a task without asking the user first. If you decide scope should expand, stop and ask before making the broader change. This applies even outside plan mode.
- If you ask the user a question, and they provide a custom option which is either a question or a request for more information, prioritize responding to that.
- Work against the current branch unless later repo instructions explicitly say otherwise.
- You may consult historical V1 code only for migration or legacy-data compatibility work.
- If you consult any historical V1 materials, explicitly disclose it to the user and name the file or files plus the compatibility reason.
- Preserve legacy V1 user data and migration-relevant files unless the user explicitly asks to delete or rewrite them.
- This preservation rule includes legacy files such as `.eberron-query-assistant/state/runtime-state.json`, `.eberron-query-assistant/state/generated-npcs.json`, `logs/*.json`, `logs/generated_npcs.md`, and `assistant/additional-context.md`.

## Repo Invariants
- Keep `README.md` focused on setup, configuration, inputs, operation, and expectations for end users. Do not update `README.md` unless the user explicitly requested the documentation change or clearly suggested the change being made.
