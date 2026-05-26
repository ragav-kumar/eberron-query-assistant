# Agent Modes

## Purpose
- This document defines task-mode workflow rules for the agent.
- Use it together with the root `CLAUDE.md`.
- Path-specific `CLAUDE.md` files remain the source of truth for local implementation constraints, especially during development work.
- Agent-governance files are files whose primary purpose is directing agent behavior, workflow, permissions, or verification rules, such as `CLAUDE.md`, `agent-modes.md`, and similar agent-rule-oriented documents.

## Mode Selection
- Every task runs in exactly one mode: `Analysis`, `Development`, `Review`, or `Introspection`.
- If the user explicitly names a mode, use that mode.
- If the user does not explicitly name a mode, infer the mode from the request.
- If the request is to create, revise, reorganize, or review agent-governance files, use `Introspection`.
- If a request mixes agent-governance edits with code work, product documentation work, or ordinary review work, stop and ask to split it into separate tasks.
- For non-trivial or multi-step tasks, state which mode you are operating in before beginning work.
- If a request mixes modes in a way that changes permissions or expected output, stop and ask the user to confirm the intended mode or staged workflow.

## Mode Switching
- A mode may continue across multiple turns in the same conversation.
- Do not silently switch modes based only on inferred intent.
- The user may explicitly switch modes at any time.
- `Introspection` is task-bound and may only be selected at the start of a task.
- Do not transition into `Introspection` after work has already begun under another mode for the same task.
- If a user requests agent-governance changes during a task already operating in `Analysis`, `Development`, or `Review`, stop and ask to begin a new task in `Introspection`.
- The agent may recommend switching modes when the current mode blocks the correct next step, but must get user confirmation before operating under the new mode.
- Treat a user message that clearly requests a new mode plus a task as an explicit mode switch.
- When a mode switch occurs, explicitly tell the user which mode you were in and which mode you are entering before proceeding under the new mode.

## Analysis
- Purpose: understand current and intended behavior before implementation.
- Typical work includes reading docs, comparing V1 and V2 behavior, inferring V2 goals from specifications and existing code, and evaluating current state.
- Code changes are not permitted.
- Documentation changes are permitted only when the user explicitly requests documentation changes.
- Agent-governance files may not be edited in this mode.
- Prefer to consult relevant specifications before drawing conclusions about intended behavior.
- Path-specific `CLAUDE.md` files are usually not the main source for this mode unless they contain relevant architectural or verification constraints needed for analysis.

## Development
- Purpose: implement behavior changes.
- Code changes are expected in this mode.
- For non-trivial work, consult `docs/fdd-v2.md` before making changes.
- Follow the root `CLAUDE.md` plus any relevant path-specific `CLAUDE.md` files for the areas being changed.
- Documentation changes are not permitted in this mode.
- Agent-governance files may not be edited in this mode.

## Development Guardrails
- If an attempted Vite start reports that the port is already in use, do not change the port. Treat that as a stale-session cleanup failure. You may only attempt to end the conflicting process when it belongs to this repository; if it does not belong to this repository, report that you cannot run the smoke check.
  - Under no circumstances should you ever change the port Vite runs on.
- Prefer plain functions, hooks, modules, and object literals over project-authored classes.
- Do not introduce class-based wrappers, service objects, or constructor-driven abstractions when a functional or module-scoped design is sufficient.
- Keep product logic, UI state transitions, presentation decisions, and user workflow behavior in the client layer when they do not require privileged Node access. Client-layer placement guidance lives in `src/client/CLAUDE.md`.
- If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.
- Before extending an existing pattern in a meaningful way, decide whether it reflects intended architecture or a local workaround.
  - If the smallest change would further entrench a brittle or one-off structure or pattern, stop and tell the user before proceeding.
  - State the risk briefly and propose the smallest cleaner alternative.
  - Skip this for mechanical edits, formatting, renames, small localized bug fixes, and changes where the requested behavior is already explicit.

## Development Verification
- Do not hand off a change while its required acceptance checks are failing.
- Execute `npm run test` for development tasks that touch automated test coverage or rely on automated test acceptance.
- Treat any test failure whose reason is not `Not implemented.` as a blocking acceptance failure that must be fixed before handoff.
- Treat a `Not implemented.` failure as a blocking acceptance failure when the failing test is affected by the current task.
- This repository is commonly worked on from Windows PowerShell.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Treat `npm audit` findings as actionable quality issues, not incidental noise. A vulnerability that can be fixed with an audit-driven dependency update is expected to be addressed when it is in scope to do so.
- Treat any high or critical vulnerability that cannot currently be fixed as a serious concern that must be surfaced clearly to the user, even when it is unrelated to the code being changed.
- If `npm audit` fails for vulnerabilities unrelated to the requested task, do not silently waive the failure. Report the failing audit result, explain whether it appears task-related, and let the user decide whether to treat the work as blocked or to narrow the acceptance scope for that task.
- Always close any agent-started dev or server processes before finalizing, including repo-local Vite and V2 API server processes.
- On Windows, do not treat a timed-out `npm run start`, `npm run start:v2-server`, or `npm run dev`, a stopped wrapper process, or a returned shell command as proof of cleanup.
- After every agent-started dev or server run on Windows, explicitly verify cleanup by confirming that no repo-local `vite.js` process remains, no repo-local `vite-node` process running `src/server/v2/server.cli.ts` remains, and no listener remains on each port used for the check.
- On Windows, cleanup verification for agent-started dev or server runs is incomplete until the repo-local `vite.js` check, the repo-local V2 API server process check, and the per-port listener checks all pass.
- For any task in which any code was changed, use `npm run verify` as the final acceptance command unless the user explicitly says otherwise.
- For any task that will affect the UI, perform a browser smoke test before handoff unless the user confirms the UI is already running.
- When using the Playwright MCP for browser smoke tests, always pass an absolute path under `$CLAUDE_JOB_DIR` as the screenshot `filename`. Relative filenames resolve to the repo root and pollute the working tree.
- After any browser smoke test session, verify that no Playwright MCP artifacts remain in the repo working directory: delete any `.playwright-mcp/` directory and any screenshot files that were created there. This check is required even when the smoke test itself passed.
- For server changes, also follow the startup and process-cleanup verification steps in `src/server/CLAUDE.md`.

## Review
- Purpose: evaluate changes and provide critique, risks, and suggestions.
- Prefer to make no changes.
- Small scoped changes are allowed only when the user explicitly requests them.
- Without switching to `Development`, review-mode edits must stay within both of these limits:
  - no more than 2 files changed
  - no more than 30 added, removed, or modified lines in total
- If a requested or necessary change would exceed either limit, stop and ask to switch to `Development`.
- Documentation changes are not permitted in this mode.
- Agent-governance files may not be edited in this mode.
- Review may use docs and code freely.
- Path-specific `CLAUDE.md` files are relevant when they affect correctness, architecture, verification expectations, or whether a requested fix remains small enough to stay in review mode.

## Introspection
- Purpose: create, revise, or reorganize agent-governance rules and workflow instructions.
- This mode is limited to files whose primary purpose is directing agent behavior, workflow, permissions, or verification rules.
- This mode may read any repository files needed to understand or revise those rules.
- Only `Introspection` may edit agent-governance files.
- While in `Introspection`, do not edit product code, product documentation, tests, configuration, or runtime assets.
- If a task begins in `Introspection`, keep the work limited to agent-governance files for the duration of that task.
