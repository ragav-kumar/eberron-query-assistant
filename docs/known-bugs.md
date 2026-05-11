# Known Bugs

Delete this file once all listed bugs are resolved.

## Foundry Export Filename Validation

- The app currently requires Foundry export files in `foundry-export/` to match a strict timestamped filename pattern before they are considered for ingestion.
- This is a bug.
- The intended behavior is that Foundry export discovery should assert only that candidate export-history files are NDJSON files.
- Chronological ordering is still expected to follow lexicographic filename order, but a file should not be rejected merely because its name does not match the current hard-coded timestamp pattern.
