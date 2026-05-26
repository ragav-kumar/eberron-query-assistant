> This document is intentionally brief. Its purpose is to capture the V2-specific product and interaction rules that should guide implementation and prompting, while relying on `docs/fdd-v1.md` for behavior that is truly unchanged.

# Additional context

- There is only one additional context
- Triggered automatically on app launch (GET)
- every other change should be a response to a PUT.

# Console

- SSE. Just always be listening.
- Fundamentally transient, so don't need to get initial state on launch.
- No GET endpoint needed. SSE-only is correct.

# Corpus management

- If either of these is active, all assistant interactions are disabled.
- There should be a way to detect "is refresh ongoing" and "when was the last refresh/reingest run". This should be a single GET. 

## Refresh

- Triggered automatically on app launch (via POST)
- Can also be triggered via a UI button

## Force Reingest

- Triggered via a UI button, via POST.
  - Only disabled if a reingest is ongoing.
- Requires a confirmation popup before it goes through
- Interrupts ongoing Refresh
  - This is the only modification enabled while Refresh is running.

# Input
- Inputs to the assistant.
- There are three inputs defined at present:
  - Prompt, a textarea
  - allowed calls to retrieval tool, on a per-prompt basis. Currently this ranges 0 to 3, default 1.
  - Checkbox to include party context. party context is part of the first prompt in a conversation, if included.
    - For second or later prompts in a given session, this checkbox should have its state locked.
  - There are assistant mode specific inputs as well

# Assistant modes
- There are currently two assistant modes defined: "Assistant" and "NPC Generator".
- This is where the Session object is actually visible in the UI
- Sessions are pre filtered by kind, and only sessions of the appropriate kind are visible in each mode tab.
- At the top of a mode tab is a dropdown which allows selecting a session. There is also a button to create a new session.
  - Creating a new session creates a "temporary" session of sorts
  - This looks like a regular session, but is transient.
  - This UI-local temporary state is replaced by the first persisted session once the first agent call is complete on that thread. By that point, the agent will have generated a session title as well.
- Eventually, I'll want to add general fuzzy text search across sessions.
- Every assistant call in all modes will look like this:
  - Send the prompt, optionally party context + additional context, and mandatorily appropriate data from RAG db
  - The final response for a given exchange will be dependent on the mode
  - The model is permitted to make 0 to 3 calls to `search_corpus()` to request additional data
    - If the model makes a tool call, it should also return a message with the following properties:
      - 1-3 sentences long.
      - Describe its reasoning, what it's searching for, and if not obvious, how it's relevant.
  - The intermediate reasoning is provided to the UI, and should be rendered.
- Show the animated "Thinking" prompt that chatgpt and codex use anytime a model call is ongoing.

### API Calls
1. GET for NPC list (not stored in session dto)
   - query params for skip, take, filter
2. GET for assistant responses (not stored in session dto)
   - path param for session id
3. GET for session summaries
   - path param to filter by mode
4. GET full info for current session
5. POST to create a new session
6. Api call to send a new prompt against an ongoing session.
   - Not sure on method. PUT? PATCH? POST?

## Mode: Assistant
- This should be rendered as a back and forth between the user and agent
- For example:
  - User prompt
  - Model message from tool call
  - Model message from tool call
  - Model response
  - User prompt
  - Model response
  - User prompt
  - Model message from tool call
  - Model response
- Each (prompt → response) set should be clearly delineated in rendering. Maybe as cards?
- Anytime api returns with new assistant data, smooth scroll to the top of the latest thing returned.
- "Thinking" prompt should be at bottom of feed.

## Mode: NPC Generator
- (server side) The assistant is configured to returns structured npc data based on the prompt.
- Use a console-like feed to render agent chatter for intermediate steps. 
  - oldest to newest, thinking prompt being after newest.
- the NPC cards are linked to a given session, but the UI should render cards from all sessions. Cards from the current session should be marked.
- Also include some basic search and pagination, sinc I'm expecting the npc count to get large
  - Should all be done server side. Use optional query params to specify skip, take, and filter.
  - Enhance the response with metadata - skip, take, total count, active filter
- Cards are sorted newest to oldest.
