import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDefaultConfig } from "../src/server/config/index.js";

const TEST_ROOT = path.resolve(".test-tmp", "config");
const ENV_KEYS = [
  "EQA_CAMPAIGN_JOURNAL_FOLDER",
  "EQA_PARTY_ACTOR_UUIDS",
  "EQA_PROVIDER_DEBUG",
  "EQA_QUESTS_JOURNAL",
  "EQA_SESSION_NOTES_JOURNAL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_CHAT_MODEL",
  "OPENAI_EMBEDDING_MODEL"
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("loadDefaultConfig", () => {
  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    await rm(TEST_ROOT, { force: true, recursive: true });
  });

  it("resolves documented repo-local default paths", () => {
    const repoRoot = path.resolve("example-repo");

    expect(loadDefaultConfig(repoRoot)).toEqual({
      repoRoot,
      assistant: {
        assistantDir: path.join(repoRoot, "assistant"),
        additionalContextPath: path.join(repoRoot, "assistant", "additional-context.md"),
        npcGeneratorPromptPath: path.join(repoRoot, "assistant", "npc-generator-prompt.md"),
        sessionTitlePromptPath: path.join(repoRoot, "assistant", "session-title-prompt.md"),
        systemPromptPath: path.join(repoRoot, "assistant", "system-prompt.md"),
        worldQueryingModePromptPath: path.join(repoRoot, "assistant", "world-querying-mode-prompt.md")
      },
      campaign: {
        campaignJournalFolder: process.env.EQA_CAMPAIGN_JOURNAL_FOLDER ?? "Legacy",
        partyActorUuids: process.env.EQA_PARTY_ACTOR_UUIDS?.split(",").map((item) => item.trim()).filter((item) => item.length > 0) ?? [],
        questsJournal: process.env.EQA_QUESTS_JOURNAL ?? "Quests",
        sessionNotesJournal: process.env.EQA_SESSION_NOTES_JOURNAL ?? "Session Notes"
      },
      foundryExportDir: path.join(repoRoot, "foundry-export"),
      pdfDir: path.join(repoRoot, "pdf"),
      runtimeDir: path.join(repoRoot, ".eberron-query-assistant"),
      logDir: path.join(repoRoot, "logs"),
      stateDir: path.join(repoRoot, ".eberron-query-assistant", "state"),
      cacheDir: path.join(repoRoot, ".eberron-query-assistant", "cache"),
      retrievalDir: path.join(repoRoot, ".eberron-query-assistant", "retrieval"),
      provider: {
        apiKey: process.env.OPENAI_API_KEY ?? null,
        baseUrl: process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") ?? "https://api.openai.com/v1",
        chatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-5.4-mini",
        debug: process.env.EQA_PROVIDER_DEBUG === "true",
        embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
      }
    });
  });

  it("loads provider settings from .env", async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    await mkdir(TEST_ROOT, { recursive: true });
    await writeFile(
      path.join(TEST_ROOT, ".env"),
      [
        "OPENAI_API_KEY=sk-test-value",
        "OPENAI_BASE_URL=https://provider.example/v1/",
        "OPENAI_CHAT_MODEL=gpt-test-chat",
        "OPENAI_EMBEDDING_MODEL=gpt-test-embedding",
        "EQA_PROVIDER_DEBUG=true",
        "EQA_PARTY_ACTOR_UUIDS=Actor.a, Actor.b,, Actor.c",
        "EQA_SESSION_NOTES_JOURNAL=Minutes",
        "EQA_QUESTS_JOURNAL=Leads",
        "EQA_CAMPAIGN_JOURNAL_FOLDER=Campaign"
      ].join("\n"),
      "utf8"
    );

    expect(loadDefaultConfig(TEST_ROOT).provider).toEqual({
      apiKey: "sk-test-value",
      baseUrl: "https://provider.example/v1",
      chatModel: "gpt-test-chat",
      debug: true,
      embeddingModel: "gpt-test-embedding"
    });
    expect(loadDefaultConfig(TEST_ROOT).campaign).toEqual({
      campaignJournalFolder: "Campaign",
      partyActorUuids: ["Actor.a", "Actor.b", "Actor.c"],
      questsJournal: "Leads",
      sessionNotesJournal: "Minutes"
    });
  });

  it("lets process environment override .env values", async () => {
    await mkdir(TEST_ROOT, { recursive: true });
    await writeFile(
      path.join(TEST_ROOT, ".env"),
      [
        "OPENAI_API_KEY=sk-env-file",
        "OPENAI_BASE_URL=https://env-file.example/v1",
        "OPENAI_CHAT_MODEL=env-file-chat",
        "OPENAI_EMBEDDING_MODEL=env-file-embedding"
      ].join("\n"),
      "utf8"
    );
    process.env.OPENAI_API_KEY = "sk-process";
    process.env.OPENAI_CHAT_MODEL = "process-chat";
    process.env.EQA_PARTY_ACTOR_UUIDS = "Actor.process";

    expect(loadDefaultConfig(TEST_ROOT).provider).toMatchObject({
      apiKey: "sk-process",
      baseUrl: "https://env-file.example/v1",
      chatModel: "process-chat",
      debug: false,
      embeddingModel: "env-file-embedding"
    });
    expect(loadDefaultConfig(TEST_ROOT).campaign.partyActorUuids).toEqual(["Actor.process"]);
  });

  it("uses model defaults when optional .env values are missing", () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    expect(loadDefaultConfig(TEST_ROOT).provider).toEqual({
      apiKey: null,
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-5.4-mini",
      debug: false,
      embeddingModel: "text-embedding-3-small"
    });
    expect(loadDefaultConfig(TEST_ROOT).campaign).toEqual({
      campaignJournalFolder: "Legacy",
      partyActorUuids: [],
      questsJournal: "Quests",
      sessionNotesJournal: "Session Notes"
    });
  });
});
