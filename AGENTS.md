# AGENTS.md

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Critical Rules
These are the highest-priority repo rules. Check them before making edits or running verification.

- Work against the current branch unless later repo instructions explicitly say otherwise.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file.
- Request escalation directly for commands known to need network access, external write permissions, or esbuild process spawning, including `npm install`, `git push`, `npm test`, targeted Vitest runs, and `npm run start`.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Do not hand off a change while its required acceptance checks are failing. During the temporary V2 transition, use `npm run verify` as the mandatory final acceptance command only when the change involves the server. For changes that do not involve the server, `npm run lint` and `npm run prestart` are the required final acceptance checks unless a later repo instruction says otherwise.
- Temporary V1 freeze rule: the V1 UI and V1 server are frozen. Do not modify them unless a change is required to unblock compilation or runtime behavior.
- During the V2 transition, treat any new user-requested feature or behavior change as targeting V2 unless the user explicitly says otherwise.
- Temporary server-only unit-test rule: until the user explicitly declares that V2 client tests are starting, do not add, update, request, or run unit tests unless the change involves the server. Repeal this rule when V2 client test work begins.
- Temporary V2 client rule: until the user explicitly declares the V2 client ready for a unit test suite, do not add, update, or request client unit tests. Only add client unit tests when the user specifically asks for them during this transition, and remove this rule once the user declares the V2 client ready.
- Do not add project-authored classes or constructors unless later repo instructions explicitly require them.
- Preserve app-owned corpus and retrieval artifacts across routine startup. Only explicit force reingest through the browser UI/API may intentionally discard, clear, or force-rebuild them.
- `docs/fdd.md` is the functional design source of truth for the theoretical current state of the application. Keep it aligned with intended current behavior, including documentation rules established through direct user discussion, rather than with known implementation bugs.
- `README.md` must be a user manual for someone cloning the repository and wanting to use the app.
- Do not update `docs/fdd.md` or `README.md` unless the user explicitly requested the documentation change or clearly suggested the change being made.

## Branch Policy
Work against the current branch unless later instructions explicitly say otherwise.

## Implementation Guardrails
During the V2 transition, treat the V1 UI and V1 server as frozen implementation surfaces. Only touch V1 code when it is necessary to unblock compilation or runtime behavior, and otherwise route requested changes to V2 unless the user explicitly directs work to V1.

Each implementation phase increments the application minor version to match the phase number. Phase 1 is `0.1.0`, Phase 2 is `0.2.0`, Phase 3 is `0.3.0`, and later phases continue that pattern. Patch revisions may be used for migration or hardening work inside a phase. The stored `appVersion` is diagnostic metadata only and must not drive compatibility decisions. Startup should validate and normalize persisted state by shape, preserving usable source and retrieval state across version bumps. The only application behavior that may intentionally discard, clear, or force-rebuild app-owned corpus or retrieval artifacts is explicit force reingest through the browser UI/API.

Keep the system modular. Maintain clear separation between:
- local browser/API runtime flow
- configuration
- source discovery
- persisted state
- ingestion pipelines
- retrieval/indexing
- provider adapters

Keep the Node layer as thin as practical. Use Node for filesystem access, process/runtime concerns, provider boundaries, persistence, and other capabilities that genuinely require the host environment. Prefer keeping product logic, UI state transitions, presentation decisions, and user workflow behavior in the React/client layer when that logic does not require privileged Node access.

Keep durable model prompt instructions in tracked Markdown files under `assistant/` as much as is reasonable. Code may assemble those prompt assets with dynamic runtime context, retrieved evidence, saved state, user input, and validation-specific constraints, but reusable assistant behavior instructions should not live as large string literals in source files.

Prefer small, testable units and explicit interfaces over hidden coupling or cross-cutting implicit behavior.

Keep persistent-state changes versioned and migration-safe. Do not make silent breaking changes to stored state or retrieval artifacts without documenting the new version and the expected upgrade path. Incompatible persisted artifacts should fail clearly and instruct the user to use the browser force-reingest control; they should not be silently deleted or rebuilt during routine startup.

Handle partial failures in a source-scoped way. Do not mark incomplete ingest or index work as current, and do not let one failed source silently invalidate successful work from another source.

Add or update automated tests alongside behavior changes when the change involves the server. During the temporary V2 transition, do not add, update, request, or run unit tests for non-server changes, and do not add or update client unit tests until the user explicitly declares the V2 client ready for that suite or specifically asks for them in the current task. Repeal this temporary exception when V2 client test work begins. If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.

For startup, source-discovery, state, API bridge, and user-visible runtime behavior changes, do not stop at unit tests. Attempt to run the start command and inspect the terminal output for the expected Vite startup behavior. Use browser/API smoke coverage when the change affects the local web app.

Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.

Do not attempt sandboxed runs of commands known to require network access or external write permissions, including `npm install`, `git push`, and similar package-management or remote-publishing commands. Request escalation directly for those commands when they are needed.

## Local Verification Workflow
This repository is commonly worked on from Windows PowerShell. Vite and Vitest load TypeScript config through esbuild, which may fail in the sandbox with `spawn EPERM`. When verification requires `npm test`, a targeted Vitest run through `npm test -- --run ...`, or `npm run start`, request escalation directly instead of first attempting the same command in the sandbox.

Use sandboxed commands for checks that do not need esbuild process spawning, such as `npm run lint` and `npm run prestart`.

There is no `npm run build` script. Use `npm run prestart` for the TypeScript no-emit check.

Use `npm run verify` as the final acceptance command for changes that involve the server. For changes that do not involve the server during the temporary V2 transition, use `npm run lint` and `npm run prestart` as the final acceptance checks instead of unit-test commands. Targeted test runs may be used during iteration when tests are in scope, but they do not replace the final full-suite gate for server-involving changes.

When starting the dev server from PowerShell for verification, invoke the Windows npm shim explicitly, for example `Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start','--','--host','127.0.0.1') ...`. `Start-Process -FilePath 'npm'` is known to fail on this setup with `%1 is not a valid Win32 application`.

Place manual smoke-test and dev-server verification stdout/stderr files under `.test-tmp/`, not under `.eberron-query-assistant/`. The `.eberron-query-assistant/` directory is reserved for app-owned runtime state, cache, retrieval artifacts, and user data.

## Coding Best Practices
Implement the project as TypeScript-first code with explicit types at important boundaries, especially around configuration, state persistence, normalized records, retrieval results, and provider adapters.

Prefer functional TypeScript. Model boundaries with interfaces and create concrete implementations with factory functions that return those interfaces. Do not add project-authored classes or constructors unless later repo instructions explicitly require them; third-party and platform constructors may still be used where their APIs require it.

Prefer arrow functions over classic `function` declarations. Use classic functions only when a platform API, TypeScript limitation, or a concrete readability/safety need makes an arrow function unsuitable.

For project-authored errors, prefer discriminated/tagged error values plus structural type guards over custom `Error` subclasses or `instanceof` checks. Formatting and classification should inspect stable fields such as `kind`, `name`, `message`, and Node-style `code`.

Avoid hidden global state outside clearly owned runtime and configuration modules. Prefer explicit dependency passing where it improves testability and behavior clarity.

Prefer deterministic, inspectable persistence formats and stable identifiers so refresh behavior, deletion logic, and debugging remain understandable.

Isolate provider-specific logic behind adapter interfaces. Ingestion, retrieval, and assistant orchestration should depend on internal contracts rather than directly on a vendor SDK.

Design ingestion and retrieval logic so most tests can run without network access or live model calls. Use mocks or fixtures for provider interactions and remote content wherever practical.

Prefer additive, comprehensible architecture over premature abstraction. Introduce indirection when it serves a clear boundary or testing need, not as speculation.

Keep terminal logging and progress output operationally useful. Startup should make it clear what is being checked, skipped, refreshed, rebuilt, or degraded.

Preserve stable source metadata needed for citations and stale-entry cleanup. If a new ingestion or retrieval path weakens provenance, treat that as a design problem to fix before proceeding.

## Maintenance Rules
If planning or implementation reveals a durable process rule or coding convention that should govern future work, update `AGENTS.md`.

For documentation maintenance:
- Keep `docs/fdd.md` focused on the theoretical current product behavior and requirements.
- Keep `README.md` focused on setup, configuration, inputs, operation, and expectations for end users.
- When documentation changes are needed but were not explicitly requested or suggested by the user, stop and confirm before editing `docs/fdd.md` or `README.md`.
