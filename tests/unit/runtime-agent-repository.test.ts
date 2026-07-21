import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeAgentRepository } from "../../src/core/agents/repository.js";

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
      capabilityIds: ["none"],
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
      capabilityIds: ["none"],
    });

    await expect(repository.createAgent({
      name: "daily-summary",
      description: "Duplicate attempt.",
      systemPrompt: "Duplicate.",
      capabilityIds: ["none"],
    })).rejects.toThrow(/already exists/i);
  });

  it("preserves all agents when createAgent calls overlap", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await Promise.all([
      repository.createAgent({
        name: "Agent One",
        description: "First agent.",
        systemPrompt: "First.",
        capabilityIds: ["none"],
      }),
      repository.createAgent({
        name: "Agent Two",
        description: "Second agent.",
        systemPrompt: "Second.",
        capabilityIds: ["none"],
      }),
    ]);

    const agents = await repository.loadAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((agent) => agent.id).sort()).toEqual(["agent-one", "agent-two"]);
  });

  it("loads legacy toolBundleIds-only persisted agents as capabilityIds", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");
    await mkdir(path.join(rootDir, "data"), { recursive: true });
    await writeFile(
      path.join(rootDir, "data", "runtime-agents.json"),
      JSON.stringify({
        version: 1,
        agents: [{
          id: "legacy-agent",
          name: "Legacy",
          description: "Legacy agent",
          systemPrompt: "Legacy",
          toolBundleIds: ["none"],
          executor: "generic",
          maxSteps: 4,
          enabled: true,
          createdAt: "2026-07-16T00:00:00.000Z",
          updatedAt: "2026-07-16T00:00:00.000Z",
        }],
      }),
      "utf8",
    );

    const agents = await repository.loadAgents();
    expect(agents[0]?.capabilityIds).toEqual(["none"]);
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
});
