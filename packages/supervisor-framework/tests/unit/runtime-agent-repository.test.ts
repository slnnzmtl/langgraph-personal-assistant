import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeAgentRepository } from "../../src/core/agents/repository.js";
import { formatDataAgentPromptBootstrap } from "../../src/core/agents/agent-prompt-bootstrap.js";
import type { RuntimeAgentPromptStore } from "../../src/core/ports/runtime-agent-prompt-store.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-agents-"));
  tempPaths.push(tempRoot);
  return tempRoot;
};

const createFakePromptStore = (): RuntimeAgentPromptStore & {
  files: Map<string, string>;
  deleted: string[];
} => {
  const files = new Map<string, string>();
  const deleted: string[] = [];

  return {
    files,
    deleted,
    describeLocation: (id: string) => `data/prompts/${id}.xml`,
    write: async (id: string, content: string) => {
      files.set(id, content);
    },
    delete: async (id: string) => {
      deleted.push(id);
      files.delete(id);
    },
  };
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

  it("writes prompt files and sets promptSourceKey when a prompt store is configured", async () => {
    const rootDir = await createTempRoot();
    const promptStore = createFakePromptStore();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", promptStore);

    const created = await repository.createAgent({
      name: "Daily Summary",
      description: "Summarize the user's day.",
      systemPrompt: "You summarize days.",
      capabilityIds: ["none"],
    });

    expect(created.promptSourceKey).toBe("daily-summary");
    expect(created.systemPrompt).toBe(formatDataAgentPromptBootstrap("daily-summary"));
    expect(promptStore.files.get("daily-summary")).toBe("You summarize days.");
    expect(repository.describePromptLocation?.("daily-summary")).toBe("data/prompts/daily-summary.xml");
  });

  it("migrates legacy inline prompts on update when a prompt store is configured", async () => {
    const rootDir = await createTempRoot();
    const promptStore = createFakePromptStore();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", promptStore);
    const timestamp = "2026-07-15T00:00:00.000Z";

    await repository.saveAgents([{
      id: "trainer",
      name: "Trainer",
      description: "Fitness coach.",
      systemPrompt: "Generate base",
      capabilityIds: ["none"],
      maxSteps: 8,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }]);

    const updated = await repository.updateAgent("trainer", {
      systemPrompt: "You are a personal trainer.",
    });

    expect(updated.promptSourceKey).toBe("trainer");
    expect(updated.systemPrompt).toBe(formatDataAgentPromptBootstrap("trainer"));
    expect(promptStore.files.get("trainer")).toBe("You are a personal trainer.");
  });

  it("updates data-managed prompt files without storing full prompt text in JSON", async () => {
    const rootDir = await createTempRoot();
    const promptStore = createFakePromptStore();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", promptStore);

    await repository.createAgent({
      name: "Coach",
      description: "Coaching agent.",
      systemPrompt: "Version 1",
      capabilityIds: ["none"],
    });

    const updated = await repository.updateAgent("coach", {
      systemPrompt: "Version 2",
    });

    expect(updated.systemPrompt).toBe(formatDataAgentPromptBootstrap("coach"));
    expect(promptStore.files.get("coach")).toBe("Version 2");
  });

  it("deletes data-managed prompt files when the agent is removed", async () => {
    const rootDir = await createTempRoot();
    const promptStore = createFakePromptStore();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", promptStore);

    await repository.createAgent({
      name: "Temporary",
      description: "Temporary agent.",
      systemPrompt: "Temporary prompt.",
      capabilityIds: ["none"],
    });

    await repository.deleteAgent("temporary");

    expect(promptStore.deleted).toEqual(["temporary"]);
    expect(promptStore.files.has("temporary")).toBe(false);
  });

  it("updates prompt files for promptSourceKey agents", async () => {
    const rootDir = await createTempRoot();
    const promptStore = createFakePromptStore();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", promptStore);
    const timestamp = "2026-07-15T00:00:00.000Z";

    await repository.saveAgents([{
      id: "finance",
      name: "Finance",
      description: "Finance agent.",
      systemPrompt: formatDataAgentPromptBootstrap("finance"),
      promptSourceKey: "finance",
      capabilityIds: ["finance-domain"],
      modelKey: "finance",
      maxSteps: 10,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }]);

    const updated = await repository.updateAgent("finance", {
      systemPrompt: "New prompt",
    });

    expect(updated.systemPrompt).toBe(formatDataAgentPromptBootstrap("finance"));
    expect(promptStore.files.get("finance")).toBe("New prompt");
  });
});
