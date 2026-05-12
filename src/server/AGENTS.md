# Server rules

Note: this is a temporary rules file and is too bloated. If any server work is done, remind the user that this file needs to be reviewed and cleaned up.

## Scope
- The `/src/server/v1` folder and its contents are frozen. They should only be modified if they are blocking compilation, tests, or runtime behavior.
- All user-requested server changes will target the v2 server, `/src/server/v2`.
- During the V2 transition, treat new user-requested server behavior changes as targeting V2 unless the user explicitly says otherwise.
- Keep the Node layer as thin as practical. Use it for filesystem access, process and runtime concerns, provider boundaries, persistence, and other capabilities that genuinely require the host environment.

## Server Structure
- Keep the system modular. Maintain clear separation between local browser and API runtime flow, configuration, source discovery, persisted state, ingestion pipelines, retrieval and indexing, and provider adapters.
- Prefer small, testable units and explicit interfaces over hidden coupling or cross-cutting implicit behavior.
- Isolate provider-specific logic behind adapter interfaces. Ingestion, retrieval, and assistant orchestration should depend on internal contracts rather than directly on a vendor SDK.
- Avoid hidden global state outside clearly owned runtime and configuration modules. Prefer explicit dependency passing where it improves testability and behavior clarity.
- Prefer deterministic, inspectable persistence formats and stable identifiers so refresh behavior, deletion logic, and debugging remain understandable.

## Persistence And Runtime Behavior
- Each implementation phase increments the application minor version to match the phase number. Phase 1 is `0.1.0`, Phase 2 is `0.2.0`, Phase 3 is `0.3.0`, and later phases continue that pattern. Patch revisions may be used for migration or hardening work inside a phase.
- The stored `appVersion` is diagnostic metadata only and must not drive compatibility decisions.
- Startup must validate and normalize persisted state by shape, preserving usable source and retrieval state across version bumps.
- Preserve app-owned corpus and retrieval artifacts across routine startup. Only explicit force reingest through the browser UI or API may intentionally discard, clear, or force-rebuild them.
- Keep persistent-state changes versioned and migration-safe. Do not make silent breaking changes to stored state or retrieval artifacts without documenting the new version and the expected upgrade path.
- Incompatible persisted artifacts should fail clearly and instruct the user to use the browser force-reingest control. They should not be silently deleted or rebuilt during routine startup.
- Handle partial failures in a source-scoped way. Do not mark incomplete ingest or index work as current, and do not let one failed source silently invalidate successful work from another source.
- Preserve stable source metadata needed for citations and stale-entry cleanup. If a new ingestion or retrieval path weakens provenance, treat that as a design problem to fix before proceeding.
- Keep terminal logging and progress output operationally useful. Startup should make it clear what is being checked, skipped, refreshed, rebuilt, or degraded.

## Testing And Verification
- Add or update automated tests alongside behavior changes when the change involves the server.
- During the temporary V2 transition, server changes are the only changes that should add, update, request, or run unit tests unless the user explicitly starts V2 client test work.
- Design ingestion and retrieval logic so most tests can run without network access or live model calls. Use mocks or fixtures for provider interactions and remote content wherever practical.
- Use `npm run verify` as the final acceptance command for changes that involve the server. Targeted test runs may be used during iteration, but they do not replace the final full-suite gate.
- For startup, source-discovery, state, API bridge, and user-visible runtime behavior changes, do not stop at unit tests. Attempt to run the start command and inspect the terminal output for the expected Vite startup behavior.
- When verification requires `npm test`, a targeted Vitest run through `npm test -- --run ...`, or `npm run start`, request escalation directly instead of first attempting the same command in the sandbox.
- When starting the dev server from PowerShell for verification, invoke the Windows npm shim explicitly, for example `Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start','--','--host','127.0.0.1') ...`. `Start-Process -FilePath 'npm'` is known to fail on this setup with `%1 is not a valid Win32 application`.
- Place manual smoke-test and dev-server verification stdout and stderr files under `.test-tmp/`, not under `.eberron-query-assistant/`. The `.eberron-query-assistant/` directory is reserved for app-owned runtime state, cache, retrieval artifacts, and user data.
