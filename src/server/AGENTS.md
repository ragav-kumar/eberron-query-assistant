# Server rules

## Scope
- The `/src/server/v1` folder and its contents are frozen. They should only be modified if they are blocking compilation, tests, or runtime behavior.
- During the V2 transition, treat new user-requested server behavior changes as targeting `/src/server/v2` unless the user explicitly says otherwise.
- Keep the Node layer as thin as practical. Put filesystem access, process/runtime concerns, persistence, and other host-only capabilities in the server layer.

## Server Structure
- Keep durable model prompt instructions in tracked Markdown files under `assistant/` as much as is reasonable. Code may assemble those prompt assets with dynamic runtime context, retrieved evidence, saved state, user input, and validation-specific constraints, but reusable assistant behavior instructions should not live as large string literals in source files.

## Persistence And Runtime Behavior
- The stored `appVersion` is diagnostic metadata only and must not drive compatibility decisions.
- Keep persistent-state changes migration-safe. Startup should validate persisted state by shape and preserve usable state across version bumps.
- Routine startup must not silently delete, rebuild, or invalidate app-owned corpus, retrieval artifacts, or other persisted user data. Incompatible artifacts should fail clearly and direct the user to an explicit force-reingest path.
- Handle ingest and index failures in a source-scoped way, preserve provenance needed for citations and cleanup, and keep startup/progress logging operationally useful.

## Testing And Verification
- Add or update automated tests alongside behavior changes when the change involves the server.
- Design ingestion and retrieval logic so most tests can run without network access or live model calls. Use mocks or fixtures for provider interactions and remote content wherever practical.
- Use `npm run verify` as the final acceptance command for changes that involve the server. Targeted test runs may be used during iteration, but they do not replace the final full-suite gate.
- Temporary V2 transition rule: do not run Vite startup smoke checks for server work until the transition ends, even for startup, source-discovery, state, API bridge, or other user-visible runtime behavior changes.
- When starting the dev server from PowerShell for verification, invoke the Windows npm shim (`npm.cmd`), not `npm`.
- After startup verification on Windows, explicitly tear down every Vite process started for the check and verify teardown by confirming both that no repo-local `vite.js` child process remains and that no listener remains on each tested port.
