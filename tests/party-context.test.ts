import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/server/config/index.js";
import { createSqliteCorpusStore, type CorpusStore } from "../src/server/ingestion/index.js";
import { createSqlitePartyContextService } from "../src/server/runtime/party-context.js";
import type { CorpusChunk, CorpusSource, RuntimeConfig } from "../src/types.js";

const TEST_ROOT = path.resolve(".test-tmp", "party-context");
const stores: CorpusStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  await rm(TEST_ROOT, { force: true, recursive: true });
});

describe("party context", () => {
  it("builds current party context from configured actors, session notes, and quests", async () => {
    const config = configWithCampaign("basic");
    const store = await seedFoundryCorpus(config);
    stores.push(store);

    const context = await createSqlitePartyContextService().build(config);

    expect(context).toContain("Current party context:");
    expect(context).toContain("Peanunt");
    expect(context).toContain("Spark");
    expect(context).toContain("Durotan");
    expect(context).not.toContain("Default Item Pile");
    expect(context).toContain("2026-04-25");
    expect(context).toContain("newer session note");
    expect(context).toContain("Main Quests");
    expect(context).toContain("Actor backstory describes what the character believes happened");
    expect(context).toContain("2026-05-02T20:09:43.241Z");
  });

  it("reports missing configured actors and journals without failing", async () => {
    const config = configWithCampaign("missing");
    config.campaign.partyActorUuids = ["Actor.missing"];
    config.campaign.sessionNotesJournal = "Missing Notes";
    config.campaign.questsJournal = "Missing Quests";
    const store = await seedFoundryCorpus(config);
    stores.push(store);

    const context = await createSqlitePartyContextService().build(config);

    expect(context).toContain("No configured party actors were found");
    expect(context).toContain("Missing configured actor UUIDs: Actor.missing");
    expect(context).toContain('No pages found for journal "Missing Notes"');
    expect(context).toContain('No pages found for journal "Missing Quests"');
  });

  it("reports unconfigured party actor UUIDs before a corpus exists", async () => {
    const config = loadDefaultConfig(path.join(TEST_ROOT, "unconfigured"));

    await expect(createSqlitePartyContextService().build(config)).resolves.toContain(
      "Party actor UUIDs are not configured"
    );
  });
});

const configWithCampaign = (name: string): RuntimeConfig => {
  const config = loadDefaultConfig(path.join(TEST_ROOT, name));
  config.campaign.partyActorUuids = ["Actor.peanunt", "Actor.spark", "Actor.durotan"];
  config.campaign.sessionNotesJournal = "Session Notes";
  config.campaign.questsJournal = "Quests";
  config.campaign.campaignJournalFolder = "Legacy";
  return config;
};

const seedFoundryCorpus = async (config: RuntimeConfig): Promise<CorpusStore> => {
  const store = createSqliteCorpusStore();
  await store.initialize(config);
  await store.replaceSourcesByType(config, "foundry", [
    foundrySource("foundry:peanunt", "world.actor.peanunt", "Peanunt", "Actor.peanunt", "Actor", [], "Peanunt believes he was betrayed by a mentor."),
    foundrySource("foundry:spark", "world.actor.spark", "Spark", "Actor.spark", "Actor", [], "Spark has a haunted-by-the-Mourning secret."),
    foundrySource("foundry:durotan", "world.actor.durotan", "Durotan", "Actor.durotan", "Actor", [], "Durotan focuses on immediate combat problems."),
    foundrySource("foundry:item-pile", "world.actor.item-pile", "Default Item Pile", "Actor.itempile", "Actor", [], "Noise."),
    foundrySource(
      "foundry:old-note",
      "world.journalentrypage.session.old",
      "2026-04-12",
      "JournalEntry.session.JournalEntryPage.old",
      "JournalEntryPage",
      ["Session Notes", "2026-04-12"],
      "Older session note.",
      "2026-04-12T00:00:00.000Z"
    ),
    foundrySource(
      "foundry:new-note",
      "world.journalentrypage.session.new",
      "2026-04-25",
      "JournalEntry.session.JournalEntryPage.new",
      "JournalEntryPage",
      ["Session Notes", "2026-04-25"],
      "A newer session note says the party reached Vathirond.",
      "2026-04-25T00:00:00.000Z"
    ),
    foundrySource(
      "foundry:main-quests",
      "world.journalentrypage.quests.main",
      "Main Quests",
      "JournalEntry.quests.JournalEntryPage.main",
      "JournalEntryPage",
      ["Quests", "Main Quests"],
      "The party is investigating trouble near Vathirond."
    )
  ]);
  return store;
};

const foundrySource = (
  sourceId: string,
  sourceKey: string,
  title: string,
  sourceUuid: string,
  entityKind: string,
  provenancePath: string[],
  text: string,
  modifiedTime: string | null = null
): { source: CorpusSource; chunks: CorpusChunk[] } => {
  const metadata = {
    sourceType: "foundry",
    entityKind,
    title,
    recordId: sourceKey,
    sourceScope: "world",
    sourceUuid,
    provenancePath,
    classificationTags: entityKind === "Actor" ? ["subtype:character"] : ["page-type:text"],
    citationAnchor: provenancePath.length > 0 ? provenancePath.join(" > ") : sourceUuid,
    modifiedTime,
    exportRunId: "run-1",
    exportGeneratedAt: "2026-05-02T20:09:43.241Z"
  };
  return {
    source: {
      sourceId,
      sourceType: "foundry",
      sourceKey,
      title,
      metadata,
      status: "succeeded"
    },
    chunks: [
      {
        chunkId: `${sourceId}:chunk:0`,
        sourceId,
        chunkIndex: 0,
        text,
        citation: {
          sourceType: "foundry",
          label: title,
          locator: metadata.citationAnchor,
          url: null
        },
        metadata
      }
    ]
  };
};
