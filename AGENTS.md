# AGENTS.md

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them. The frozen historical-document rule is not overrideable.

## Critical Rules
These are the highest-priority repo rules. Check them before making edits, running verification, or updating documentation.

- Work against the current branch unless later repo instructions or active enhancement documentation explicitly say otherwise.
- Do not modify frozen historical documents:
  - `docs/specification.md`
  - `docs/phase-01-project-scaffold.md`
  - `docs/phase-02-source-discovery-and-state.md`
  - `docs/phase-03-ingestion-pipelines.md`
  - `docs/phase-04-retrieval-layer.md`
  - `docs/phase-05-interactive-assistant.md`
  - `docs/phase-05.5-vector-storage-migration.md`
  - `docs/phase-06-hardening-and-alignment.md`
- Record post-Phase 6 intended behavior only in `docs/enhancements.md`.
- Update `README.md` whenever active enhancement documentation changes intended user-visible behavior.
- Do not create additional enhancement, planning, or specification documents unless the user explicitly asks for them.
- Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file.
- Request escalation directly for commands known to need network access, external write permissions, or esbuild process spawning, including `npm install`, `git push`, `npm test`, targeted Vitest runs, and `npm run start`.
- Use `npm run prestart` for the TypeScript no-emit check. There is no `npm run build` script.
- Do not hand off a non-docs change while `npm run verify` is failing. For any change that modifies code, tests, config, tooling, or package metadata outside documentation-only files, `npm run verify` is the mandatory final acceptance command and it must pass before the change can be accepted.
- Do not add project-authored classes or constructors unless later active enhancement documentation explicitly requires them.
- Preserve app-owned corpus and retrieval artifacts across routine startup. Only explicit force reingest through the browser UI/API may intentionally discard, clear, or force-rebuild them.

## Branch Policy
Work against the current branch unless later instructions or active enhancement documentation explicitly say otherwise.

## Documentation Set And Output Order
Create and maintain the governing documentation set in this order:

1. `AGENTS.md`
2. historical baseline documents, when reading for context only:
   - `docs/specification.md`
   - `docs/phase-01-project-scaffold.md`
   - `docs/phase-02-source-discovery-and-state.md`
   - `docs/phase-03-ingestion-pipelines.md`
   - `docs/phase-04-retrieval-layer.md`
   - `docs/phase-05-interactive-assistant.md`
   - `docs/phase-05.5-vector-storage-migration.md`
   - `docs/phase-06-hardening-and-alignment.md`
3. `docs/enhancements.md`
4. `README.md`

If one document changes the durable rules for another, update the upstream governing document as part of the same work.

## Document Responsibilities
Each document has a distinct audience and purpose.

### `AGENTS.md`
- Durable repo instructions.
- Documentation governance.
- Implementation guardrails.
- Coding best practices that should remain true across phases.

### Historical Baseline Documents
- `docs/specification.md` and phase documents through Phase 6 are historical baseline documents.
- They describe the completed baseline through Phase 6 and are no longer active planning or specification targets.
- They are frozen after their historical status notice has been added.
- Do not modify them again. This rule is repeated in the Critical Rules list because it is not overrideable.

### New Enhancement Documentation
- Any further changes after Phase 6 are enhancements on top of the historical baseline.
- Record post-Phase 6 intended behavior only in `docs/enhancements.md` instead of editing `docs/specification.md` or phase documents through Phase 6.
- `docs/enhancements.md` is a high-level change log for intentional deviations from the historical baseline, so future sessions can tell that those changes are deliberate.
- Keep entries concise. Record the behavior change, the reason it exists when useful, and any verification note needed to understand that the divergence is intentional.

### `README.md`
- Human-facing project overview and usage guide.
- A description of the intended finished system.
- A user document, not a planning or contributor workflow document.

## Historical Baseline Rules
`docs/specification.md` is the authoritative historical baseline spec through Phase 6. The frozen historical records are listed in Critical Rules and must not be modified again.

New enhancement documentation must:
- Live only in `docs/enhancements.md`.
- Stay high-level and chronological.
- Identify intentional behavior changes on top of the Phase 6 historical baseline.
- Include verification notes only when they materially help a future session understand that the change was deliberate.

`docs/enhancements.md` describes changes on top of the historical baseline. It must not silently rewrite the Phase 6 baseline; it should identify intentional deviations as enhancements. Do not create phase-specific enhancement documents.

## Implementation Guardrails
Use the historical baseline documents as context for the Phase 6 product state. For enhancement work, document new intended behavior in `docs/enhancements.md` rather than editing the frozen specification or frozen phase documents.

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

Add or update automated tests alongside behavior changes. If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.

For startup, source-discovery, state, API bridge, and user-visible runtime behavior changes, do not stop at unit tests. Attempt to run the start command and inspect the terminal output for the expected Vite startup behavior. Use browser/API smoke coverage when the change affects the local web app.

Document assumptions, invariants, and unresolved decisions explicitly in the governing docs rather than leaving them implied in code structure or commit history.

Update `README.md` whenever intended user-visible behavior changes.

Do not restore, recreate, or preserve obsolete untracked local files unless the current task explicitly requires that exact file. Gitignored runtime artifacts, generated logs, and converted legacy files may represent deliberate local cleanup or migration state. Treat changes made outside the current session as user-owned work: do not revert, reintroduce, or "helpfully" reconstruct them while doing unrelated implementation or documentation work.

Do not attempt sandboxed runs of commands known to require network access or external write permissions, including `npm install`, `git push`, and similar package-management or remote-publishing commands. Request escalation directly for those commands when they are needed.

## Local Verification Workflow
This repository is commonly worked on from Windows PowerShell. Vite and Vitest load TypeScript config through esbuild, which may fail in the sandbox with `spawn EPERM`. When verification requires `npm test`, a targeted Vitest run through `npm test -- --run ...`, or `npm run start`, request escalation directly instead of first attempting the same command in the sandbox.

Use sandboxed commands for checks that do not need esbuild process spawning, such as `npm run lint` and `npm run prestart`.

There is no `npm run build` script. Use `npm run prestart` for the TypeScript no-emit check.

Use `npm run verify` as the final acceptance command for any non-docs change. Targeted test runs may be used during iteration, but they do not replace the final full-suite gate. Documentation-only changes may stop at the smaller checks that are appropriate to the files touched.

When starting the dev server from PowerShell for verification, invoke the Windows npm shim explicitly, for example `Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start','--','--host','127.0.0.1') ...`. `Start-Process -FilePath 'npm'` is known to fail on this setup with `%1 is not a valid Win32 application`.

Place manual smoke-test and dev-server verification stdout/stderr files under `.test-tmp/`, not under `.eberron-query-assistant/`. The `.eberron-query-assistant/` directory is reserved for app-owned runtime state, cache, retrieval artifacts, and user data.

## Coding Best Practices
Implement the project as TypeScript-first code with explicit types at important boundaries, especially around configuration, state persistence, normalized records, retrieval results, and provider adapters.

Prefer functional TypeScript. Model boundaries with interfaces and create concrete implementations with factory functions that return those interfaces. Do not add project-authored classes or constructors unless later active enhancement documentation explicitly requires them; third-party and platform constructors may still be used where their APIs require it.

Prefer arrow functions over classic `function` declarations. Use classic functions only when a platform API, TypeScript limitation, or a concrete readability/safety need makes an arrow function unsuitable.

For project-authored errors, prefer discriminated/tagged error values plus structural type guards over custom `Error` subclasses or `instanceof` checks. Formatting and classification should inspect stable fields such as `kind`, `name`, `message`, and Node-style `code`.

Avoid hidden global state outside clearly owned runtime and configuration modules. Prefer explicit dependency passing where it improves testability and behavior clarity.

Prefer deterministic, inspectable persistence formats and stable identifiers so refresh behavior, deletion logic, and debugging remain understandable.

Isolate provider-specific logic behind adapter interfaces. Ingestion, retrieval, and assistant orchestration should depend on internal contracts rather than directly on a vendor SDK.

Design ingestion and retrieval logic so most tests can run without network access or live model calls. Use mocks or fixtures for provider interactions and remote content wherever practical.

Prefer additive, comprehensible architecture over premature abstraction. Introduce indirection when it serves a clear boundary or testing need, not as speculation.

Keep terminal logging and progress output operationally useful. Startup should make it clear what is being checked, skipped, refreshed, rebuilt, or degraded.

Preserve stable source metadata needed for citations and stale-entry cleanup. If a new ingestion or retrieval path weakens provenance, treat that as a design problem to fix before proceeding.

## README Rules
`README.md` must describe the final intended behavior of the project rather than the current implementation status.

The README must:
- Explain project purpose and expected inputs.
- Explain how to run the application and what user-facing behavior to expect.
- Avoid planning notes, contributor instructions, implementation status, and future-work commentary.
- Stay consistent with the latest active enhancement documentation and the frozen historical baseline.

Instructions about how the README should be written belong here or in active enhancement documentation, not in the README itself.

## Maintenance Rules
If planning or implementation reveals a durable process rule, documentation constraint, or coding convention that should govern future work, update `AGENTS.md`.

If active enhancement documentation changes intended user-visible behavior, update `README.md` so it reflects the intended result rather than the current state of the repository.
