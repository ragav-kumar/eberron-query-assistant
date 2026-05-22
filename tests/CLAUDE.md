# Test Rules

## Scope
- These rules apply to files under `/tests`.
- This file is relevant in all modes.

## Test Intent
- Prefer tests that validate user-visible behavior, durable invariants, and meaningful service contracts.
- Do not write tests whose main purpose is to ratify a specific code edit, implementation detail, helper call sequence, or refactor shape unless that detail is itself a required contract.
- A good test should answer "what behavior must remain true?" rather than "did the code change in the way I expected?"
- Do not add new tests when the current task is already sufficiently covered by existing suites.
- If a new test is still needed, justify why the existing suites do not already provide adequate coverage for the task.

## Unit Tests First
- Prefer actual unit tests by default.
- Unit tests should isolate the subject under test from databases, filesystem state, network access, process state, and unrelated subsystems unless the purpose of the test is specifically to cover one of those boundaries.
- Use mocks, fakes, or stubs when the dependency is not the behavior being tested.
- Favor narrow seams such as mocked app contexts, repository-like interfaces, fetchers, parsers, stores, event publishers, and coordinators over booting whole runtime stacks.

## Integration Boundaries
- Use real filesystem, SQLite, retrieval artifacts, or multi-step runtime composition only when the test is intentionally an integration test.
- Keep integration tests fewer than unit tests and make their purpose explicit.
- If a real persistence or filesystem test is necessary, isolate it from live app-owned paths and explain why a mock would be insufficient.
- Never rely on or write to the live app database, live retrieval database, or normal app-owned runtime directories during tests.

## Mocks and Seams
- If a test is hard to write without extensive real setup, treat that as pressure to improve seams rather than as a reason to expand fixture churn.
- Prefer mocking collaborators at stable boundaries instead of mocking deep internal helpers with brittle call-order assertions.
- Avoid hand-rolled mocks that recreate large parts of real implementations when a smaller fake or a test-support package would be clearer.

## Packages
- Do not avoid additional packages out of habit when a package is the best solution.
- Prefer established test-support packages when they materially improve clarity, isolation, safety, or maintenance cost.
- Examples of appropriate package use include typed mock helpers, in-memory filesystem tools, HTTP test clients, property-based testing libraries, and temp-directory helpers.
- When introducing a package, choose the smallest tool that solves the actual testing problem and keep the reason for using it explicit in the change rationale.

## Review Expectations
- When reviewing tests, call out cases where:
  - the test is really integration coverage disguised as a unit test
  - the test depends on filesystem or database writes without needing to
  - the assertions overfit implementation details instead of behavior
  - a package would simplify the harness and reduce custom test code

## Verification Expectations
- Execute `npm run test` when the task depends on automated test acceptance.
- Any test failure whose reason is not `Not implemented.` is a blocking acceptance failure.
- A `Not implemented.` failure is also blocking when the failing test is affected by the current task.

## V1 and V2
- V1 is frozen. Do not add new V1 tests.
- New tests should target V2 behavior unless the user explicitly requests otherwise.
