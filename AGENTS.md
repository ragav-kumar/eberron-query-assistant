# AGENTS.md

## Purpose
This file defines durable repository rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Branch Policy
Work against the current branch unless later instructions or a written specification explicitly say otherwise.

## Documentation Set And Output Order
Create and maintain the governing documentation set in this order:

1. `AGENTS.md`
2. `docs/specification.md`
3. `docs/phase-*.md`
4. `README.md`

If one document changes the durable rules for another, update the upstream governing document as part of the same work.

## Document Responsibilities
Each document has a distinct audience and purpose.

### `AGENTS.md`
- Durable repo instructions.
- Documentation governance.
- Implementation guardrails.
- Coding best practices that should remain true across phases.

### `docs/specification.md`
- The authoritative final-state engineering specification.
- The exhaustive definition of the intended finished system.
- The source of truth for architecture, workflows, interfaces, storage, failure handling, and validation expectations.

### `docs/phase-*.md`
- The phased implementation plan.
- Decision-complete descriptions of incremental delivery steps toward the final-state spec.
- The place where each phase defines its goal, scope, tests, end state, and human verification.

### `README.md`
- Human-facing project overview and usage guide.
- A description of the intended finished system.
- A user document, not a planning or contributor workflow document.

## Specification Rules
`docs/specification.md` must remain the authoritative final-state spec file.

Phase planning must live in `docs/phase-*.md`, not inside `docs/specification.md`, except for brief references that help readers navigate the documentation set.

The specification must be exhaustive and decision-complete. If a previously open technical decision is resolved during planning or implementation, update the specification, this file, and the README as needed so the documentation set remains internally consistent.

The final-state spec must:
- Define exact finished behavior for startup refresh, ingestion, retrieval, assistant runtime, failure handling, and verification.
- Define the intended architecture, module boundaries, storage model, configuration model, and technology choices.
- Record assumptions and unresolved decisions instead of leaving them implicit.
- Be written as implementation guidance for the finished system, not as a brainstorm or progress log.

Each phase document must:
- Define the phase goal.
- Define the scope of work for the phase.
- Identify out-of-scope work where needed to prevent ambiguity.
- State the expected project state at the end of the phase.
- Include required automated tests.
- Include concrete human verification steps.
- Record assumptions or prerequisites that materially affect implementation.

Phase documents stage delivery toward the final-state specification. They must not redefine finished product behavior independently of `docs/specification.md`.

## Implementation Guardrails
Use the final-state specification as the product source of truth. If an implementation detail in a phase document conflicts with `docs/specification.md`, update the phase document or the specification so the conflict is resolved explicitly.

Each implementation phase increments the application minor version to match the phase number. Phase 1 is `0.1.0`, Phase 2 is `0.2.0`, Phase 3 is `0.3.0`, and later phases continue that pattern. Runtime state uses the application version as its compatibility marker; if stored runtime state was written by a different app version, startup must invalidate it and rebuild app-owned runtime artifacts.

Keep the system modular. Maintain clear separation between:
- CLI/runtime flow
- configuration
- source discovery
- persisted state
- ingestion pipelines
- retrieval/indexing
- provider adapters

Prefer small, testable units and explicit interfaces over hidden coupling or cross-cutting implicit behavior.

Keep persistent-state changes versioned and migration-safe. Do not make silent breaking changes to stored state or retrieval artifacts without documenting the new version and the expected upgrade path.

Handle partial failures in a source-scoped way. Do not mark incomplete ingest or index work as current, and do not let one failed source silently invalidate successful work from another source.

Add or update automated tests alongside behavior changes. If a change is intentionally left without automated coverage, document the risk and provide manual verification steps.

For startup, source-discovery, state, CLI, and user-visible runtime behavior changes, do not stop at unit tests. Attempt to run the start command and inspect the terminal output for the expected behavior. When the prompt would otherwise remain interactive, pipe or provide an immediate `exit` input so the verification exercises startup without hanging.

Document assumptions, invariants, and unresolved decisions explicitly in the governing docs rather than leaving them implied in code structure or commit history.

Update `README.md` whenever the final intended user-visible behavior changes.

Do not attempt sandboxed runs of commands known to require network access or external write permissions, including `npm install`, `git push`, and similar package-management or remote-publishing commands. Request escalation directly for those commands when they are needed.

## Coding Best Practices
Implement the project as TypeScript-first code with explicit types at important boundaries, especially around configuration, state persistence, normalized records, retrieval results, and provider adapters.

Prefer functional TypeScript. Model boundaries with interfaces and create concrete implementations with factory functions that return those interfaces. Do not add project-authored classes or constructors unless a later written specification explicitly requires them; third-party and platform constructors may still be used where their APIs require it.

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
- Stay consistent with the latest approved specification.

Instructions about how the README should be written belong here or in the specification, not in the README itself.

## Maintenance Rules
If planning or implementation reveals a durable process rule, documentation constraint, or coding convention that should govern future work, update `AGENTS.md`.

If the final-state specification changes intended user-visible behavior, update `README.md` so it reflects the final intended result rather than the current state of the repository.
