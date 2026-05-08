# Retrieval Tool Assistant Enhancement

## Purpose

Allow assistant workflows to treat local corpus retrieval as a native model tool instead of a single fixed pre-answer lookup. This document is an agent-facing planning artifact for later implementation; it intentionally does not change current intended behavior until implementation work updates active enhancement documentation.

The enhancement should preserve the existing first-pass retrieval behavior while giving the model a bounded way to request additional targeted evidence when the initial context is not enough.

## Intended Interaction

Each assistant request starts with the current retrieval pass:

- The app retrieves initial evidence and provides it to the model with the user prompt.
- If the model can answer from that context, it returns the final answer immediately.
- If the model needs more information, it calls a native `search_corpus` tool with a targeted query.
- The app runs retrieval, returns matching chunks as tool output, and lets the model continue.
- The loop stops when the model returns final output or reaches the configured retrieval back-and-forth limit.

The user controls extra retrieval back-and-forths with a UI slider. The slider range is `0` to `3`, with default `1`. A value of `0` preserves single-pass behavior: initial retrieval is still provided, but the model cannot request additional retrieval.

## Tool Contract

Use native Chat Completions tool calls for this enhancement, not a migration to the Responses API.

Expose one local tool:

```json
{
  "name": "search_corpus",
  "description": "Search the local Eberron corpus for targeted supporting evidence.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string"
      },
      "sourceTypes": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["foundry", "pdf", "article"]
        }
      },
      "sourceKeys": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 8
      },
      "userMessage": {
        "type": "string"
      }
    },
    "required": ["query", "userMessage"]
  }
}
```

`userMessage` is concise user-facing progress text that explains what the model is retrieving and why. It must not contain hidden reasoning or chain-of-thought.

The app should validate tool arguments, clamp result limits to an internal maximum of `8`, execute retrieval through the existing retrieval service, and return formatted chunks using the same citation standards as initial evidence.

If the model requests retrieval after the configured limit is exhausted, the app should return a tool result explaining that no more retrieval turns are available and require the model to produce final output from the evidence already provided.

## Development Phases

1. **Standard Assistant Tool Loop**
   - Extend the provider contract to support native tool definitions, assistant tool calls, and tool-result messages.
   - Add a shared retrieval-tool loop that wraps the current Standard assistant request flow.
   - Preserve existing Standard answer metadata behavior, including session title and response title tags.
   - Add the shared UI slider and pass the selected limit through the Standard assistant API request.
   - Put non-final Standard progress text in the Log before the final answer.

2. **NPC Generator Tool Support**
   - Add retrieval-tool support to NPC Generator only after any additional output-shape concerns are resolved.
   - Preserve the final strict JSON NPC response contract.
   - Send any non-final NPC mode progress text to the Console for now, not the Log.
   - Continue saving valid final NPC cards through the existing generated NPC state path.

Phase 2 may reuse the provider and retrieval-loop infrastructure from Phase 1, but it should not weaken NPC JSON validation or allow progress text to be parsed as final NPC output.

## Progress Output Rules

Standard assistant mode:

- Non-final model progress text belongs in the Log.
- Final answers remain normal transcript exchanges with response titles and Markdown answer content.

NPC Generator mode:

- Any non-final model progress text belongs in the Console for now.
- Final output remains strict JSON only.
- Saved NPC cards remain the primary user-facing NPC output.

## Test Coverage

Provider coverage should include tool-call request payloads, parsing assistant tool calls, tool-result messages, final text responses, and provider diagnostics without leaking API keys.

Standard assistant coverage should include no tool use, one tool use, capped repeated tool use, exhausted limit behavior, limit `0`, and metadata repair after tool-assisted responses.

UI and API coverage should include slider default `1`, slider range `0` to `3`, disabled busy state, and request payloads carrying the selected retrieval limit.

NPC Generator Phase 2 coverage should be added only if and when NPC tool support is implemented. Those tests should prove that tool progress goes to Console, final JSON validation remains strict, and saved NPC state updates only from valid final output.

## Assumptions

This document exists because the user explicitly requested a planning document, which overrides the normal repository rule against creating additional planning documents for this task.

No frozen historical documents should be modified for this enhancement. Do not update `README.md` or `docs/enhancements.md` until implementation changes intended user-visible behavior.
