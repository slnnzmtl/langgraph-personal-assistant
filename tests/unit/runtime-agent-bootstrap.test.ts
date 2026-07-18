import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ensureBuiltinRuntimeAgents } from "../../src/runtime-agents/bootstrap.js";
import { createRuntimeAgentRepository } from "../../src/core/agents/repository.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

describe("ensureBuiltinRuntimeAgents", () => {
  it("seeds finance, obsidian, and configuration agents when the store is empty", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    const agents = await ensureBuiltinRuntimeAgents(repository);

    expect(agents.map((agent) => agent.id)).toEqual(["configuration", "finance", "obsidian"]);
    expect(agents.find((agent) => agent.id === "finance")?.executor).toBe("finance");
    expect(agents.find((agent) => agent.id === "obsidian")?.executor).toBe("obsidian");
    expect(agents.find((agent) => agent.id === "configuration")?.executor).toBe("configuration");
  });

  it("disables finance when Supabase is unavailable", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    const agents = await ensureBuiltinRuntimeAgents(repository, { financeAvailable: false });

    expect(agents.find((agent) => agent.id === "finance")?.enabled).toBe(false);
  });

  it("raises builtin maxSteps when persisted values are lower than the current default", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await repository.saveAgents([
      {
        id: "obsidian",
        name: "Obsidian",
        description: "old description",
        systemPrompt: "old",
        toolBundleIds: ["obsidian-vault"],
        skillAttachments: [],
        executor: "obsidian",
        builtin: true,
        maxSteps: 8,
        enabled: true,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
    ]);

    const agents = await ensureBuiltinRuntimeAgents(repository);
    const obsidian = agents.find((agent) => agent.id === "obsidian");

    expect(obsidian?.maxSteps).toBeGreaterThanOrEqual(12);
    expect(obsidian?.description).toBe("old description");
  });
});
