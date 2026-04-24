# AGENTS.md

## Purpose
This file defines durable authoring and documentation rules for `eberron-query-assistant`.

Follow these rules unless a later instruction in the repo or task explicitly overrides them.

## Branch Policy
Work against the current branch unless later instructions or a written specification explicitly say otherwise.

## Output Order
Create and maintain the initial documentation set in this order:

1. `AGENTS.md`
2. `docs/specification.md`
3. `README.md`

If one document changes the durable rules for another, update the upstream governing document as part of the same work.

## Document Responsibilities
Each document has a distinct audience and purpose.

### `AGENTS.md`
- Durable repo instructions.
- Documentation and planning rules.
- Constraints for how the spec and README are authored.

### `docs/specification.md`
- The single authoritative engineering spec.
- The complete phased implementation plan.
- The place where technical decisions, interfaces, workflows, failure handling, and verification criteria are defined.

### `README.md`
- Human-facing project overview and usage guide.
- A description of the intended finished system.
- A user document, not a planning or contributor workflow document.

## Specification Rules
`docs/specification.md` must remain the single authoritative spec file unless the project later becomes complex enough that splitting it is clearly justified.

The spec must be exhaustive and decision-complete. If a previously open technical decision is resolved during planning, update the spec, this file, and the README as needed so the documentation set remains internally consistent.

The spec must:
- Be explicit about what is implemented in each phase.
- Define exact behavior for startup refresh, ingestion, assistant runtime, and verification.
- Record assumptions and unresolved decisions instead of leaving them implicit.
- Include concrete human verification steps for every phase.
- Be written as implementation guidance, not as a brainstorm or progress log.

## README Rules
`README.md` must describe the final intended behavior of the project rather than the current implementation status.

The README must:
- Explain project purpose and expected inputs.
- Explain how to run the application and what user-facing behavior to expect.
- Avoid planning notes, contributor instructions, implementation status, and future-work commentary.
- Stay consistent with the latest approved spec.

Instructions about how the README should be written belong here or in the spec, not in the README itself.

## Maintenance Rules
If spec authoring reveals a durable process rule, documentation constraint, or authoring convention that should govern future work, update `AGENTS.md`.

If the spec changes intended user-visible behavior, update `README.md` so it reflects the final intended result rather than the current state of the repository.
