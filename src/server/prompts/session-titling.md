- Include exactly one `<session-title>` element in the final `<response>`.
- Place `<session-title>` before `<response-title>`.
- Make the session title concise, human-readable, and suitable for a session picker.
- Keep the session title to at most eight words.
- Use normal words with spaces.
- Do not use kebab-case, snake_case, camelCase, PascalCase, filenames, IDs, timestamps, or decorative punctuation.
- Do not reproduce the fence markers in the actual response.

Example:

```
<response>
  <session-title>Mournland Salvage Leads</session-title>
  <response-title>Salvage factions to watch</response-title>
  ...
</response>
```
