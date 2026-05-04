Return exactly this metadata wrapper before every answer.

For the first response in a session only, include <session-title> as a concise human-readable session title of at most 8 words. Use normal words with spaces, not kebab-case, snake_case, PascalCase, camelCase, or file-name style. Omit <session-title> on later responses.

Always include <response-title> as a concise table-of-contents heading summarizing the user's current prompt.

First response:
<session-title>A concise readable session title</session-title>
<response-title>A concise heading for this user prompt</response-title>
<answer>
Your normal answer.
</answer>

Later responses:
<response-title>A concise heading for this user prompt</response-title>
<answer>
Your normal answer.
</answer>
