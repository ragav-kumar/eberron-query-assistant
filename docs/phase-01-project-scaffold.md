# Phase 01: Project Scaffold

> Historical baseline: this phase document records completed Phase 1 planning. Further changes are enhancements on top of the Phase 6 baseline and must be documented elsewhere. Do not modify this document again.

## Goal
Establish the TypeScript, Node.js, Vitest, and ESLint foundation for the CLI application, along with the initial module boundaries required by later phases.

## Scope
- Initialize package metadata, scripts, and TypeScript configuration for an ESM-first Node.js CLI project.
- Configure Vitest and ESLint for the expected repository structure.
- Create the CLI entrypoint and a startup flow skeleton that performs argument parsing, initializes logging/progress output, and enters a stub interactive prompt after placeholder startup work.
- Define initial module boundaries for:
  - configuration
  - CLI/runtime
  - source discovery
  - persisted state
  - ingestion
  - retrieval
  - provider adapters
- Establish conventions that keep later ingestion and retrieval logic testable and decoupled.

## Out Of Scope
- Real source ingestion
- Retrieval implementation
- Model-provider integration
- Persistent runtime state beyond placeholders needed to define interfaces

## Required Tests
- Configuration loading tests
- CLI argument parsing tests
- Progress/log formatting tests where output is structured enough to validate
- Entry-point smoke test for startup skeleton behavior

## Project State At End Of Phase
At the end of this phase, the repository contains a runnable CLI scaffold with working scripts, linting, and tests. The application can be launched locally, prints startup placeholder progress, and enters a stub chat loop or prompt shell. The codebase is organized around stable module seams that later phases can fill in without broad refactoring.

## Human Verification
- Install dependencies successfully.
- Run lint and automated tests successfully.
- Run the default CLI entrypoint and confirm:
  - startup output is visible in the terminal
  - placeholder refresh steps are readable
  - the process transitions into a stub interactive prompt

## Assumptions And Prerequisites
- This phase sets the baseline toolchain for all later phases.
- The final-state behavior in [`specification.md`](./specification.md) governs interface and module design decisions made here.
