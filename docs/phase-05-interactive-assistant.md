# Phase 05: Interactive Assistant

## Goal
Connect retrieval to a provider-backed interactive terminal assistant that answers questions with grounded citations and clear distinction between direct support and inference.

## Scope
- Integrate the selected OpenAI-compatible provider behind dedicated chat and embedding adapter boundaries.
- Implement retrieval-driven prompt construction that separates instructions from evidence.
- Launch an interactive terminal chat session after startup refresh completes.
- Generate responses that include a direct answer or summary plus supporting references when available.
- Preserve in-process session memory only for the current run.
- Ensure the runtime can answer direct lookup, comparison, and inference-heavy questions across foundry, PDFs, and articles.

## Out Of Scope
- Persistent cross-session memory
- GUI or web interface
- Advanced UX features beyond terminal interaction and citation-aware responses

## Required Tests
- Prompt assembly tests
- Citation formatting tests
- Session-memory reset tests
- Provider adapter tests with mocked responses
- End-to-end smoke tests with mocked model completions and retrieval results

## Project State At End Of Phase
At the end of this phase, the product behaves as the intended terminal assistant: startup refresh completes, chat begins, questions are answered using retrieved evidence, and citations are surfaced in the response. The system supports both direct retrieval and evidence-based synthesis.

## Human Verification
- Ask sample lore and campaign questions and confirm answers include useful supporting references.
- Ask an inference-heavy question and confirm the answer reads as synthesis rather than pretending to be a direct quote.
- Restart the app and confirm prior chat history is not retained.
- End the process with `Ctrl+C` and confirm shutdown is clean enough for normal terminal use.

## Assumptions And Prerequisites
- Phase 04 retrieval behavior is stable and citation metadata is available.
- Provider-specific code remains isolated behind adapter boundaries.
- Most tests continue to use mocks so they do not require live provider calls.
