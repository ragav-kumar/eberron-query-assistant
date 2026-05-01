# AGENTS.md

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them. The frozen historical-document rule is not overrideable.

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
3. new enhancement documentation
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
- Do not modify them again.

### New Enhancement Documentation
- Any further changes after Phase 6 are enhancements on top of the historical baseline.
- New planning or specification work must live in new enhancement documentation instead of editing `docs/specification.md` or phase documents through Phase 6.
- Minor enhancements must be recorded in `docs/phase-X-enhancements.md`, where `X` is the current minor-version phase number.
- Each `docs/phase-X-enhancements.md` file must include a table of contents and list minor enhancements in chronological order.
- Create standalone `docs/phase-X-*.md` files only for large changes that need their own implementation plan.
- Enhancement documents must define their goal, scope, tests, end state, and human verification where applicable.

### `README.md`
- Human-facing project overview and usage guide.
- A description of the intended finished system.
- A user document, not a planning or contributor workflow document.

## Historical Baseline Rules
`docs/specification.md` is the authoritative historical baseline spec through Phase 6.

The following documents are frozen historical records:
- `docs/specification.md`
- `docs/phase-01-project-scaffold.md`
- `docs/phase-02-source-discovery-and-state.md`
- `docs/phase-03-ingestion-pipelines.md`
- `docs/phase-04-retrieval-layer.md`
- `docs/phase-05-interactive-assistant.md`
- `docs/phase-05.5-vector-storage-migration.md`
- `docs/phase-06-hardening-and-alignment.md`

Do not modify these frozen historical documents again.

New enhancement documentation must:
- Define the phase goal.
- Define the scope of work for the phase.
- Identify out-of-scope work where needed to prevent ambiguity.
- State the expected project state at the end of the phase.
- Include required automated tests.
- Include concrete human verification steps.
- Record assumptions or prerequisites that materially affect implementation.
- For minor enhancements, place the entry in the current `docs/phase-X-enhancements.md` document, update its table of contents, and preserve chronological order.

Enhancement documents describe changes on top of the historical baseline. They must not silently rewrite the Phase 6 baseline; they should identify intentional deviations as enhancements.

## Implementation Guardrails
Use the historical baseline documents as context for the Phase 6 product state. For enhancement work, document new intended behavior in new enhancement documentation rather than editing the frozen specification or frozen phase documents.

Each implementation phase increments the application minor version to match the phase number. Phase 1 is `0.1.0`, Phase 2 is `0.2.0`, Phase 3 is `0.3.0`, and later phases continue that pattern. Patch revisions may be used for migration or hardening work inside a phase. The stored `appVersion` is diagnostic metadata only and must not drive compatibility decisions. Startup should validate and normalize persisted state by shape, preserving usable source and retrieval state across version bumps. The only application behavior that may intentionally discard, clear, or force-rebuild app-owned corpus or retrieval artifacts is explicit force re-ingest through `--force-reingest` or `npm run reingest`.

Keep the system modular. Maintain clear separation between:
- CLI/runtime flow
- configuration
- source discovery
- persisted state
- ingestion pipelines
- retrieval/indexing
- provider adapters

Prefer small, testable units and explicit interfaces over hidden coupling or cross-cutting implicit behavior.

Keep persistent-state changes versioned and migration-safe. Do not make silent breaking changes to stored state or retrieval artifacts without documenting the new version and the expected upgrade path. Incompatible persisted artifacts should fail clearly and instruct the user to run `npm run reingest`; they should not be silently deleted or rebuilt during routine startup.

Handle partial failures in a source-scoped way. Do not mark incomplete ingest or index work as current, and do not let one failed source silently invalidate successful work from another source.

Add or update automated tests alongside behavior changes. If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.

For startup, source-discovery, state, CLI, and user-visible runtime behavior changes, do not stop at unit tests. Attempt to run the start command and inspect the terminal output for the expected behavior. When the prompt would otherwise remain interactive, pipe or provide an immediate `exit` input so the verification exercises startup without hanging.

Document assumptions, invariants, and unresolved decisions explicitly in the governing docs rather than leaving them implied in code structure or commit history.

Update `README.md` whenever intended user-visible behavior changes.

Do not attempt sandboxed runs of commands known to require network access or external write permissions, including `npm install`, `git push`, and similar package-management or remote-publishing commands. Request escalation directly for those commands when they are needed.

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
