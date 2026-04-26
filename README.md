# Eberron Query Assistant

Eberron Query Assistant is a terminal-based lore and campaign assistant for an Eberron game corpus. It combines three source types into one queryable knowledge base:

- Foundry VTT export data from `foundry-export/`
- local PDFs from `pdf/`
- Keith Baker articles discovered from the Eberron index

On startup, the application refreshes its retrieval layer before opening chat. It checks whether the latest foundry export has changed, detects newly added or removed PDFs, and looks for new Keith Baker articles on the configured schedule. Unchanged sources are skipped so routine launches stay fast, and a full-refresh script is available when a full rebuild is needed.

By default, local runtime state and retrieval artifacts are stored under `.eberron-query-assistant/` in the repository.
Runtime state is tied to the application version; when the app version changes, stale local runtime artifacts are invalidated and rebuilt from the configured inputs.

Detailed engineering and phased-delivery documentation lives in `docs/specification.md` and the `docs/phase-*.md` files. This README remains focused on the intended finished user experience.

After startup completes, the app opens an interactive terminal session. You can ask direct lore questions, cross-reference campaign data, or ask inference-heavy questions that require combining material across sources. Answers are designed to include a direct response and supporting references when available, such as PDF page citations, article links, or specific foundry entities.

## What It Is For
- answering Eberron setting and lore questions from your local corpus
- surfacing campaign-specific facts from Foundry-exported records
- combining PDFs, articles, and foundry data in one assistant workflow
- supporting both straightforward lookup and synthesized reasoning

## Expected Inputs
The project expects these source locations by default:

- `foundry-export/manifest.json`
- `foundry-export/records.ndjson`
- `pdf/`

Keith Baker articles are discovered from the Eberron index and cached into the local retrieval layer after ingestion.

## Usage
Install dependencies and run the default CLI entrypoint:

```bash
npm install
npm run start
```

Run a full rebuild when you want to ignore incremental skip logic:

```bash
npm run reingest
```

Inspect retrieval results for a query without entering chat:

```bash
npm run debug:retrieval -- "aerenal deathless"
```

The intended workflow is to run the project from this repository: start the application, let it refresh the corpus, then interact with the assistant in the terminal. Use `npm run reingest` when you need a full rebuild.

## Example Questions
- What are the names of the clans of the Znir?
- I have a Vult Hwyri. What considerations should I have when constructing her personality?
- Explain the Path of Light.
- What traditions might a casual follower of Gatekeeper?
- What are some common magic items or professions that Keith Baker has talked about?
- Do any of the players have connections to Thrane?
- Do any of the NPCs in Vathirond have connections to Aundair?

## Expected Answer Style
Answers should provide:
- a direct response or concise summary
- references to relevant PDFs, articles, or foundry records when available
- inference that is grounded in retrieved material rather than unsupported guesswork

For PDF-backed answers, expect citations such as title or filename and page context when available. For article-backed answers, expect article title and URL. For foundry-backed answers, expect the relevant entity name and type.
