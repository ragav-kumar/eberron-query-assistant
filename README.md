# Eberron Query Assistant

Eberron Query Assistant is a local browser-based lore and campaign assistant for an Eberron game corpus. It combines three source types into one queryable knowledge base:

- Foundry VTT export data from `foundry-export/`
- local PDFs from `pdf/`
- Keith Baker articles discovered from the Eberron index

Assistant and NPC Generator instructions are stored in tracked Markdown files under `assistant/`. Local campaign notes or other assistant-only guidance that does not belong in the source corpus can be edited in the app through a WYSIWYG Markdown editor backed by `assistant/additional-context.md`. That file is gitignored, is created as an empty file when missing, and is included in every assistant prompt only when it contains text.

Standard assistant prompts also receive automatic party context assembled from the local Foundry corpus. Configure the party actor UUIDs and campaign journal names in `.env`; `.env.example` documents the supported keys. Session Notes are used for what happened in play, Quests are used for active or expected quest threads, actor-sheet mechanics are treated as character-sheet facts, and actor backstory is treated as what the character believes rather than guaranteed objective truth.

The application refreshes its retrieval layer automatically before the first assistant or NPC generator prompt in a browser-server session when needed. It also provides controls to refresh during use. It checks whether the latest foundry export has changed, detects newly added or removed PDFs, and looks for new Keith Baker articles on the configured schedule. Unchanged sources are skipped so routine refreshes stay fast, and a force-reingest control is available when a full rebuild is needed. Keith Baker raw index and article HTML is cached locally so force reingest can usually rebuild article corpus rows without refetching every article page.

The local Console output streams what is being checked, skipped, refreshed, rebuilt, or degraded while operations run. If the browser reloads or reconnects while the same local server process is still running, the Console feed and active operation status are restored from server memory. If one source fails while another source remains usable, the app can continue in degraded mode and names the affected source type. If no retrieval corpus is available, refresh fails clearly. Console output is a transient local feed and is not saved to transcript logs.

By default, local runtime state and retrieval artifacts are stored under `.eberron-query-assistant/` in the repository.
Runtime state records the application version for diagnostics only. Routine refresh preserves existing local state and retrieval artifacts across version changes; the app only intentionally clears or force-rebuilds its corpus when you use the force-reingest control.
Each app session writes assistant exchanges to an active local JSON transcript under `logs/`, which is gitignored. Transcript files are named from the timestamp and assistant-provided session title, and each exchange stores the user prompt, a table-of-contents heading, and the assistant's Markdown answer. Generated NPC cards are saved as local runtime state under `.eberron-query-assistant/state/generated-npcs.json`. The right column of the app separates transient Console output, the persisted Log tab, and saved NPC cards. The Log tab starts empty, can browse saved transcripts with a dropdown, renders a linked table of contents and separated Q&A pairs, and treats older transcripts as read-only. Standard assistant prompts always write to the current session, creating one lazily when needed. NPC Generator prompts write to persistent NPC state; revising an existing NPC id updates that saved card. Use `New session` from the active output workflow to clear the Standard conversation or reset NPC generation context without deleting existing files. These transcripts and generated NPC state are not loaded as future assistant memory.

Detailed engineering and historical phased-delivery documentation lives in `docs/specification.md`, historical phase documents, and `docs/enhancements.md`. This README remains focused on the intended finished user experience.

The app opens a local browser UI. The left column contains input tabs for assistant workflows and editable additional context. In the Input tab, choose Standard assistant mode or NPC Generator mode. You can ask direct lore questions, cross-reference campaign data, refresh the corpus, generate lore-aware NPC names and cards, or ask inference-heavy questions that require combining material across sources. Standard answers are designed to include a direct response and supporting references when available, such as PDF page citations, article links, or specific foundry entities. NPC Generator answers return structured NPC cards with an id, name, physical description, very short bio, and knowable details such as species, ethnicity, gender, role, and approximate age; the NPCs tab tiles those cards when the output pane is wide enough.

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
- optional automatic party context settings in `.env`

Keith Baker articles are discovered from the Eberron index and cached into the local retrieval layer after ingestion. The raw Keith Baker HTML cache is stored under `.eberron-query-assistant/cache/keith-baker/`; delete that directory before force reingest only when you intentionally want to redownload article pages.
Article pages that return HTTP 403 or 404 are recorded as permanently inaccessible and skipped on later runs.

## Usage
Install dependencies and run the local GUI:

```bash
npm install
npm run start
```

Open the Vite URL printed by the command. Use the in-app refresh control for optional routine source checks, the force-reingest control when you need an explicit full rebuild, the Input tab for Standard assistant prompts or NPC Generator prompts, and the Additional Context tab for local assistant-only notes. Standard assistant prompts automatically include configured party context after refresh. Press Enter to submit the active input; use Shift+Enter for new lines in text areas. Use the Console tab for unsaved local operational output, the Log tab to browse saved assistant transcripts, and the NPCs tab to browse saved generated cards.

## Example Questions
- What are the names of the clans of the Znir?
- I have a Vult Hwyri. What considerations should I have when constructing her personality?
- Explain the Path of Light.
- What traditions might a casual follower of Gatekeeper?
- What are some common magic items or professions that Keith Baker has talked about?
- Do any of the players have connections to Thrane?
- Do any of the NPCs in Vathirond have connections to Aundair?
- Generate three goblin NPCs native to Aundair.

## Expected Answer Style
Answers should provide:
- a direct response or concise summary
- references to relevant PDFs, articles, or foundry records when available
- inference that is grounded in retrieved material rather than unsupported guesswork

For PDF-backed answers, expect citations such as title or filename and page context when available. For article-backed answers, expect article title and URL. For foundry-backed answers, expect the relevant entity name and type.
