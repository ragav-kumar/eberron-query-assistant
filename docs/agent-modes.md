# Agent Modes

## Purpose
- This document defines task-mode workflow rules for the agent.
- Use it together with the root `AGENTS.md`.
- Path-specific `AGENTS.md` files remain the source of truth for local implementation constraints, especially during development work.
- Agent-governance files are files whose primary purpose is directing agent behavior, workflow, permissions, or verification rules, such as `AGENTS.md`, `agent-modes.md`, and similar agent-rule-oriented documents.

## Mode Selection
- Every task runs in exactly one mode: `Analysis`, `Development`, `Review`, or `Introspection`.
- If the user explicitly names a mode, use that mode.
- If the user does not explicitly name a mode, infer the mode from the request.
- If the request is to create, revise, reorganize, or review agent-governance files, use `Introspection`.
- If a request mixes agent-governance edits with code work, product documentation work, or ordinary review work, stop and ask to split it into separate tasks.
- Explicitly tell the user which mode you are operating in before doing work.
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
- Path-specific `AGENTS.md` files are usually not the main source for this mode unless they contain relevant architectural or verification constraints needed for analysis.

## Development
- Purpose: implement behavior changes.
- Code changes are expected in this mode.
- During the V2 transition, default to V2 unless the user explicitly requires V1 work or V1 changes are necessary to unblock compilation or runtime behavior.
- For non-trivial V2 work, consult `docs/fdd-v2.md` before making changes.
- For non-trivial V1 work that is explicitly required, consult `docs/fdd-v1.md` before making changes.
- Follow the root `AGENTS.md` plus any relevant path-specific `AGENTS.md` files for the areas being changed.
- Documentation changes are not permitted in this mode.
- Agent-governance files may not be edited in this mode.

## Development Guardrails
- During the V2 transition, treat user-requested changes as targeting V2 by default. The V1 client and V1 server are frozen unless changes are required to unblock compilation or runtime behavior.
- During the V2 transition, `server/v2` and `client/v2` code may not reference V1 code under any circumstances. This prohibition is absolute.
- If an attempted Vite start reports that the port is already in use, do not change the port. Treat that as a stale-session cleanup failure. You may only attempt to end the conflicting process when it belongs to this repository; if it does not belong to this repository, report that you cannot run the smoke check.
  - Under no circumstances should you ever change the port Vite runs on.
- Prefer plain functions, hooks, modules, and object literals over project-authored classes.
- Do not introduce class-based wrappers, service objects, or constructor-driven abstractions when a functional or module-scoped design is sufficient.
- Keep product logic, UI state transitions, presentation decisions, and user workflow behavior in the client layer when they do not require privileged Node access. Client-layer placement guidance lives in `src/client/AGENTS.md`.
- If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.
- Before extending an existing pattern in a meaningful way, decide whether it reflects intended architecture or a local workaround.
  - If the smallest change would further entrench a brittle or one-off structure or pattern, stop and tell the user before proceeding.
  - State the risk briefly and propose the smallest cleaner alternative.
  - Skip this for mechanical edits, formatting, renames, small localized bug fixes, and changes where the requested behavior is already explicit.

## Development Verification
- Do not hand off a change while its required acceptance checks are failing.
- This repository is commonly worked on from Windows PowerShell. Vite and Vitest load TypeScript config through esbuild, which may fail in the sandbox with `spawn EPERM`.
- Request escalation directly for commands known to need network access, external write permissions, or esbuild process spawning, including `npm install`, `git push`, `npm test`, targeted Vitest runs, `npm run start`, `npm run start:v2-server`, and `npm run dev`.
- If a workflow is discovered to require escalation in this environment, treat it as an escalation-required workflow in future runs and update the relevant `AGENTS.md` guidance when that behavior is durable.
- Use sandboxed commands for checks that do not need esbuild process spawning, such as `npm run lint` and `npm run prestart`.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Treat `npm audit` findings as actionable quality issues, not incidental noise. A vulnerability that can be fixed with an audit-driven dependency update is expected to be addressed when it is in scope to do so.
- Treat any high or critical vulnerability that cannot currently be fixed as a serious concern that must be surfaced clearly to the user, even when it is unrelated to the code being changed.
- If `npm audit` fails for vulnerabilities unrelated to the requested task, do not silently waive the failure. Report the failing audit result, explain whether it appears task-related, and let the user decide whether to treat the work as blocked or to narrow the acceptance scope for that task.
- Always close any agent-started dev or server processes before finalizing, including repo-local Vite and V2 API server processes.
- On Windows, do not treat a timed-out `npm run start`, `npm run start:v2-server`, or `npm run dev`, a stopped wrapper process, or a returned shell command as proof of cleanup.
- After every agent-started dev or server run on Windows, explicitly verify cleanup by confirming that no repo-local `vite.js` process remains, no repo-local `vite-node` process running `src/server/v2/server.cli.ts` remains, and no listener remains on each port used for the check.
- On Windows, cleanup verification for agent-started dev or server runs is incomplete until the repo-local `vite.js` check, the repo-local V2 API server process check, and the per-port listener checks all pass.
- For non-server changes during the temporary V2 transition, use `npm run lint` and `npm run prestart` as the final acceptance checks instead of unit-test commands.
- For server changes, follow the final acceptance workflow in `src/server/AGENTS.md`.

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
- Review may use docs, V2 code, and when useful V1 code for comparison or regression detection.
- Path-specific `AGENTS.md` files are relevant when they affect correctness, architecture, verification expectations, or whether a requested fix remains small enough to stay in review mode.

## Introspection
- Purpose: create, revise, or reorganize agent-governance rules and workflow instructions.
- This mode is limited to files whose primary purpose is directing agent behavior, workflow, permissions, or verification rules.
- This mode may read any repository files needed to understand or revise those rules.
- Only `Introspection` may edit agent-governance files.
- While in `Introspection`, do not edit product code, product documentation, tests, configuration, or runtime assets.
- If a task begins in `Introspection`, keep the work limited to agent-governance files for the duration of that task.
