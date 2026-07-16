import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeAgentRepository } from "../../src/runtime-agents/repository.js";
import { ROUTINE_SKILL_ATTACHMENTS } from "../../src/runtime-agents/skill-attachments.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-agents-"));
  tempPaths.push(tempRoot);
  return tempRoot;
};

describe("createRuntimeAgentRepository", () => {
  it("loads an empty list when the runtime agents file does not exist", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await expect(repository.loadAgents()).resolves.toEqual([]);
  });

  it("creates, updates, and deletes runtime agents", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    const created = await repository.createAgent({
      name: "Daily Summary",
      description: "Summarize the user's day.",
      systemPrompt: "You summarize days.",
      toolBundleIds: ["none"],
      maxSteps: 5,
    });

    expect(created.id).toBe("daily-summary");
    expect(created.enabled).toBe(true);

    const updated = await repository.updateAgent(created.id, {
      enabled: false,
      description: "Summarize the user's day in plain language.",
    });

    expect(updated.enabled).toBe(false);
    expect(updated.description).toBe("Summarize the user's day in plain language.");

    const deleted = await repository.deleteAgent(created.id);
    expect(deleted.id).toBe("daily-summary");
    await expect(repository.loadAgents()).resolves.toEqual([]);
  });

  it("rejects duplicate runtime agent names", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await repository.createAgent({
      name: "Daily Summary",
      description: "Summarize the user's day.",
      systemPrompt: "You summarize days.",
      toolBundleIds: ["none"],
    });

    await expect(repository.createAgent({
      name: "daily-summary",
      description: "Duplicate attempt.",
      systemPrompt: "Duplicate.",
      toolBundleIds: ["none"],
    })).rejects.toThrow(/already exists/i);
  });

  it("rejects invalid persisted runtime agent data", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");
    await mkdir(path.join(rootDir, "data"), { recursive: true });
    await writeFile(
      path.join(rootDir, "data", "runtime-agents.json"),
      JSON.stringify({ version: 1, agents: [{ id: "bad-agent" }] }),
      "utf8",
    );

    await expect(repository.loadAgents()).rejects.toThrow(/invalid runtime agent/i);
  });

  it("persists skill attachment rules on create and update", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    const created = await repository.createAgent({
      name: "Routine Helper",
      description: "Creates routine notes.",
      systemPrompt: "You create routine notes.",
      toolBundleIds: ["obsidian-vault"],
      skillAttachments: ROUTINE_SKILL_ATTACHMENTS,
    });

    expect(created.skillAttachments).toEqual(ROUTINE_SKILL_ATTACHMENTS);

    const updated = await repository.updateAgent(created.id, {
      skillAttachments: [],
    });

    expect(updated.skillAttachments).toEqual([]);
  });
});
