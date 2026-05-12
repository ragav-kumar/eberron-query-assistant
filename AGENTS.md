# REPO wide rules
## WORKING, IGNORE THIS SECTION
- Keep product logic, UI state transitions, presentation decisions, and user workflow behavior in the client layer when they do not require privileged Node access.

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Critical Rules
These are the highest-priority repo rules. Check them before making edits or running verification.

- Work against the current branch unless later repo instructions explicitly say otherwise.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file.
- Request escalation directly for commands known to need network access, external write permissions, or esbuild process spawning, including `npm install`, `git push`, `npm test`, targeted Vitest runs, and `npm run start`.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Do not hand off a change while its required acceptance checks are failing. During the temporary V2 transition, non-server changes require `npm run lint` and `npm run prestart` as the final acceptance checks unless a later repo instruction says otherwise. Server-specific final acceptance rules live in `src/server/AGENTS.md`.
- Temporary V1 freeze rule: the V1 UI and V1 server are frozen. Module-specific guidance lives in `src/client/AGENTS.md` and `src/server/AGENTS.md`.
- During the V2 transition, treat any new user-requested feature or behavior change as targeting V2 unless the user explicitly says otherwise.
- During the temporary V2 transition, module-specific unit-test rules live in `src/client/AGENTS.md` and `src/server/AGENTS.md`.
- Do not add project-authored classes or constructors unless later repo instructions explicitly require them.
- `README.md` must be a user manual for someone cloning the repository and wanting to use the app.
- Documentation guidance for files under `docs/` lives in `docs/AGENTS.md`.
- Do not update `README.md` unless the user explicitly requested the documentation change or clearly suggested the change being made.

## Branch Policy
Work against the current branch unless later instructions explicitly say otherwise.

## Implementation Guardrails
During the V2 transition, treat the V1 UI and V1 server as frozen implementation surfaces. Only touch V1 code when it is necessary to unblock compilation or runtime behavior, and otherwise route requested changes to V2 unless the user explicitly directs work to V1. Module-specific implementation guidance lives in `src/client/AGENTS.md` and `src/server/AGENTS.md`.

Keep product logic, UI state transitions, presentation decisions, and user workflow behavior in the client layer when they do not require privileged Node access. Client-layer placement guidance lives in `src/client/AGENTS.md`.

Keep durable model prompt instructions in tracked Markdown files under `assistant/` as much as is reasonable. Code may assemble those prompt assets with dynamic runtime context, retrieved evidence, saved state, user input, and validation-specific constraints, but reusable assistant behavior instructions should not live as large string literals in source files.

Prefer small, testable units and explicit interfaces over hidden coupling or cross-cutting implicit behavior.

If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.

Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.

Do not attempt sandboxed runs of commands known to require network access or external write permissions, including `npm install`, `git push`, and similar package-management or remote-publishing commands. Request escalation directly for those commands when they are needed.

## Local Verification Workflow
This repository is commonly worked on from Windows PowerShell. Vite and Vitest load TypeScript config through esbuild, which may fail in the sandbox with `spawn EPERM`. When verification requires `npm test`, a targeted Vitest run through `npm test -- --run ...`, or `npm run start`, request escalation directly instead of first attempting the same command in the sandbox.

Use sandboxed commands for checks that do not need esbuild process spawning, such as `npm run lint` and `npm run prestart`.

There is no `npm run build` script. Use `npm run prestart` for the TypeScript no-emit check.

For non-server changes during the temporary V2 transition, use `npm run lint` and `npm run prestart` as the final acceptance checks instead of unit-test commands. Server-specific verification workflow lives in `src/server/AGENTS.md`.

## Coding Best Practices
Implement the project as TypeScript-first code with explicit types at important boundaries.

Prefer functional TypeScript. Model boundaries with interfaces and create concrete implementations with factory functions that return those interfaces. Do not add project-authored classes or constructors unless later repo instructions explicitly require them; third-party and platform constructors may still be used where their APIs require it.

Prefer arrow functions over classic `function` declarations. Use classic functions only when a platform API, TypeScript limitation, or a concrete readability/safety need makes an arrow function unsuitable.

For project-authored errors, prefer discriminated/tagged error values plus structural type guards over custom `Error` subclasses or `instanceof` checks. Formatting and classification should inspect stable fields such as `kind`, `name`, `message`, and Node-style `code`.

Prefer additive, comprehensible architecture over premature abstraction. Introduce indirection when it serves a clear boundary or testing need, not as speculation.

## Maintenance Rules
If planning or implementation reveals a durable process rule or coding convention that should govern future work, update `AGENTS.md`.

For documentation maintenance:
- Keep `README.md` focused on setup, configuration, inputs, operation, and expectations for end users.
- Documentation maintenance rules for files under `docs/` live in `docs/AGENTS.md`.
- When documentation changes are needed but were not explicitly requested or suggested by the user, stop and confirm before editing `README.md`.
