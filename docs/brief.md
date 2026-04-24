**This brief is only for use during spec development. Delete this file once the spec has been created and fully approved.**

# Summary
This project is the second part of a 2-part project.
- Part 1 was a foundry VTT module that scraped all journal, item, actor, compendium, etc data from foundry and created an export file and a manifest.
- Part 2 (this part) consumes that export, as well as a set of PDFs from DMs guild and other such sources, to serve as a corpus of data by a querying engine / ai assistant.

# On startup
Every time the application is launched, update the retrieval layer:
- Examine the foundry-export for any changes (additions, updates, removals)
  - Maintain a checksum, hash, timestamp, or something similarly fast to evaluate so that this can be skipped if there has been no new exports since last launch.
  - The format and contents of the manifest file can be trusted.
- Check if a new PDF has appeared, or if an existing PDF is gone.
  - PDF contents will never change, you do not need to re-analyze a pdf if the name is unchanged.
- Visit https://keith-baker.com/eberron-index/ and scrape any new links in the content area of the page. Do not re-scrape articles which have been previously scraped.
  - Do this no more frequently than once a week. If the last scrape was completed less than a week ago, skip this step.

A retrieval layer should be maintained in whatever manner or format is best suited for the AI assistant. The details of this should be laid out in the spec.
There must be command line feedback of progress for this launch work.

There should be a command line flag to force a full re-ingest.

# The assistant
After startup work is complete, launch an interactive chat session
- Memory does not need to and should not be maintained between sessions
- The session will last until the application is terminated (Ctrl+C is sufficient here, unless the AI requires cleanup)

The assistant is a query and inference engine. Responses must include a text summary or response if relevant, and references to PDFs or specific foundry items if possible.
Sample questions (not exhaustive):
- What are the names of the clans of the Znir? (this one requires inference, since the clans are named after Eberron's moons)
- I have a Vult Hwyri. What considerations should I have when constructing her personality?
- Explain the Path of Light.
- What traditions might a casual follower of Gatekeeper?
- What are some common magic items or professions that Keith Baker has talked about?
- Do any of the players have connections to Thrane?
- Do any of the NPCs in Vathirond have connections to Aundair?

# The output to be generated
First, create an AGENTS.md file with best practices. Update this file as needed based on the spec.
After creating the spec, create the README file. The README file is human facing, and should reflect what the final result of the repo should look like. i.e. it should not reflect current status, but final behaviour. Instructions about the README should be in AGENTS and the spec, not in the README. The README's purpose is to summarize the project goals and provide instructions on usage.

Create a phased specification document.
- The document should be exhaustive and cover all decisions that will need to be made during work.
- The project itself should be node / typescript / vitest / eslint. For the retrieval layer, run the options by me.
- The document should include information on phases of development, and should be explicit as to what should be implemented in each phase.
- Every phase should have something that I (the human) can verify for correctness.