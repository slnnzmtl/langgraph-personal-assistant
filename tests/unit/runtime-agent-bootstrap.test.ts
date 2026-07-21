import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ensureBuiltinRuntimeAgents } from "../../src/runtime-agents/bootstrap.js";
import { applyLocalModuleAvailability } from "../../src/app/composition/bootstrap-agents.js";
import { createRuntimeAgentRepository } from "../../src/core/agents/repository.js";
import { buildLocalModuleAgents } from "../helpers/runtime-agent-fixtures.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

describe("ensureBuiltinRuntimeAgents", () => {
  it("seeds only the configuration agent when the store is empty", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    const agents = await ensureBuiltinRuntimeAgents(repository);

    expect(agents.map((agent) => agent.id)).toEqual(["configuration"]);
    expect(agents.find((agent) => agent.id === "configuration")?.executor).toBe("configuration");
    expect(agents.find((agent) => agent.id === "configuration")?.builtin).toBe(true);
  });

  it("preserves local module agents from persistence", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await repository.saveAgents(buildLocalModuleAgents());

    const agents = await ensureBuiltinRuntimeAgents(repository);

    expect(agents.map((agent) => agent.id)).toEqual(["configuration", "finance", "obsidian"]);
    expect(agents.find((agent) => agent.id === "finance")?.executor).toBe("finance");
    expect(agents.find((agent) => agent.id === "obsidian")?.executor).toBe("obsidian");
  });

  it("merges configuration overrides without touching local modules", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
    tempPaths.push(rootDir);
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await repository.saveAgents([
      {
        id: "configuration",
        name: "Configuration",
        description: "custom description",
        systemPrompt: "old",
        toolBundleIds: ["system-config"],
        executor: "configuration",
        modelKey: "configuration",
        builtin: true,
        maxSteps: 6,
        enabled: false,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
      {
        id: "obsidian",
        name: "Obsidian",
        description: "local description",
        systemPrompt: "local prompt",
        toolBundleIds: ["obsidian-vault"],
        executor: "obsidian",
        builtin: false,
        maxSteps: 8,
        enabled: true,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
    ]);

    const agents = await ensureBuiltinRuntimeAgents(repository);
    const configuration = agents.find((agent) => agent.id === "configuration");
    const obsidian = agents.find((agent) => agent.id === "obsidian");

    expect(configuration?.description).toBe("custom description");
    expect(configuration?.maxSteps).toBeGreaterThanOrEqual(10);
    expect(configuration?.enabled).toBe(false);
    expect(obsidian?.description).toBe("local description");
    expect(obsidian?.maxSteps).toBe(8);
  });
});

describe("applyLocalModuleAvailability", () => {
  it("disables finance-domain agents when Supabase is unavailable", () => {
    const agents = applyLocalModuleAvailability(buildLocalModuleAgents(), { supabaseAvailable: false });

    const financeAgent = agents.find((agent) => agent.toolBundleIds.includes("finance-domain"));
    const obsidianAgent = agents.find((agent) => agent.toolBundleIds.includes("obsidian-vault"));

    expect(financeAgent?.enabled).toBe(false);
    expect(obsidianAgent?.enabled).toBe(true);
  });
});
