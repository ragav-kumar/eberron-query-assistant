# REPO wide rules

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Critical Rules
These are the highest-priority repo rules. Check them before making edits or running verification.

- Work against the current branch unless later repo instructions explicitly say otherwise.
- During the V2 transition, treat user-requested changes as targeting V2 by default. The V1 client and V1 server are frozen unless changes are required to unblock compilation or runtime behavior. Module-specific guidance lives in `src/client/AGENTS.md` and `src/server/AGENTS.md`.
- Request escalation directly for commands known to need network access, external write permissions, or esbuild process spawning, including `npm install`, `git push`, `npm test`, targeted Vitest runs, and `npm run start`.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Do not hand off a change while its required acceptance checks are failing. During the temporary V2 transition, non-server changes require `npm run lint` and `npm run prestart` as the final acceptance checks unless a later repo instruction says otherwise. Server-specific final acceptance rules live in `src/server/AGENTS.md`.
- Do not add project-authored classes or constructors unless later repo instructions explicitly require them.
- Keep `README.md` focused on setup, configuration, inputs, operation, and expectations for end users. Do not update `README.md` unless the user explicitly requested the documentation change or clearly suggested the change being made.

## Implementation Guardrails
- Keep product logic, UI state transitions, presentation decisions, and user workflow behavior in the client layer when they do not require privileged Node access. Client-layer placement guidance lives in `src/client/AGENTS.md`.
- If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.
- Before extending an existing pattern in a meaningful way, decide whether it reflects intended architecture or a local workaround.
  - If the smallest change would further entrench a brittle or one-off structure or pattern, stop and tell the user before proceeding.
  - State the risk briefly and propose the smallest cleaner alternative.
  - Skip this for mechanical edits, formatting, renames, small localized bug fixes, and changes where the requested behavior is already explicit.

## Local Verification Workflow
- This repository is commonly worked on from Windows PowerShell. Vite and Vitest load TypeScript config through esbuild, which may fail in the sandbox with `spawn EPERM`.
- When verification requires `npm test`, a targeted Vitest run through `npm test -- --run ...`, or `npm run start`, request escalation directly instead of first attempting the same command in the sandbox.
- If a workflow is discovered to require escalation in this environment, treat it as an escalation-required workflow in future runs and update the relevant `AGENTS.md` guidance when that behavior is durable.
- Use sandboxed commands for checks that do not need esbuild process spawning, such as `npm run lint` and `npm run prestart`.
- For non-server changes during the temporary V2 transition, use `npm run lint` and `npm run prestart` as the final acceptance checks instead of unit-test commands. Server-specific verification workflow lives in `src/server/AGENTS.md`.

For documentation maintenance:
- Documentation maintenance rules for files under `docs/` live in `docs/AGENTS.md`.
