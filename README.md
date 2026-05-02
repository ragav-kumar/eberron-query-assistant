# Eberron Query Assistant

Eberron Query Assistant is a local browser-based lore and campaign assistant for an Eberron game corpus. It combines three source types into one queryable knowledge base:

- Foundry VTT export data from `foundry-export/`
- local PDFs from `pdf/`
- Keith Baker articles discovered from the Eberron index

Assistant instructions are stored in tracked Markdown files under `assistant/`. Local campaign notes or other assistant-only guidance that does not belong in the source corpus can be edited in the app through a WYSIWYG Markdown editor backed by `assistant/additional-context.md`. That file is gitignored, is created as an empty file when missing, and is included in every assistant prompt only when it contains text.

The application refreshes its retrieval layer automatically before the first assistant or debug query in a browser-server session when needed. It also provides controls to refresh during use. It checks whether the latest foundry export has changed, detects newly added or removed PDFs, and looks for new Keith Baker articles on the configured schedule. Unchanged sources are skipped so routine refreshes stay fast, and a force-reingest control is available when a full rebuild is needed.

The local Console output reports what was checked, skipped, refreshed, rebuilt, or degraded. If one source fails while another source remains usable, the app can continue in degraded mode and names the affected source type. If no retrieval corpus is available, refresh fails clearly. Console output is a transient local feed and is not saved to transcript logs.

By default, local runtime state and retrieval artifacts are stored under `.eberron-query-assistant/` in the repository.
Runtime state records the application version for diagnostics only. Routine refresh preserves existing local state and retrieval artifacts across version changes; the app only intentionally clears or force-rebuilds its corpus when you use the force-reingest control.
Each app session writes assistant exchanges to an active local Markdown transcript under `logs/`, which is gitignored. The right column of the app separates transient Console output from the persisted Markdown Log tab, and both output panes auto-scroll as new content arrives. These transcripts are not loaded as future assistant memory.

Detailed engineering and historical phased-delivery documentation lives in `docs/specification.md`, historical phase documents, and `docs/enhancements.md`. This README remains focused on the intended finished user experience.

The app opens a local browser UI. The left column contains input tabs for assistant/query workflows and editable additional context. In the Input tab, choose Standard assistant mode, Debug Query mode, or the stubbed Name Generator mode. You can ask direct lore questions, cross-reference campaign data, run debug retrieval queries, refresh the corpus, or ask inference-heavy questions that require combining material across sources. Answers are designed to include a direct response and supporting references when available, such as PDF page citations, article links, or specific foundry entities.

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
- optional local assistant context in `assistant/additional-context.md`

Keith Baker articles are discovered from the Eberron index and cached into the local retrieval layer after ingestion.
Article pages that return HTTP 403 or 404 are recorded as permanently inaccessible and skipped on later runs.

## Usage
Install dependencies and run the local GUI:

```bash
npm install
npm run start
```

Open the Vite URL printed by the command. Use the in-app refresh control for optional routine source checks, the force-reingest control when you need an explicit full rebuild, the Input tab for Standard assistant prompts or Debug Query retrieval inspection, and the Additional Context tab for local assistant-only notes. Press Enter to submit the active input; use Shift+Enter for new lines in the assistant prompt. Use the Console tab for unsaved local operational output and the Log tab for saved assistant transcript output.

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
