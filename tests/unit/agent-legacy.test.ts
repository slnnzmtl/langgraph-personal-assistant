import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyExecutorAgent } from "../../src/app/composition/agent-legacy.js";
import { parseRuntimeAgentDefinition } from "../../src/core/types/agent.js";
import { createRuntimeAgentRepository } from "../../src/core/agents/repository.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createTempRoot = async (): Promise<string> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pa-agent-legacy-"));
  tempPaths.push(tempRoot);
  return tempRoot;
};

describe("agent legacy migration", () => {
  it("migrates legacy finance executor agents to generic while preserving the finance model key", () => {
    const normalized = migrateLegacyExecutorAgent(parseRuntimeAgentDefinition({
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      promptSourceKey: "finance",
      capabilityIds: ["finance-domain"],
      executor: "finance",
      modelKey: "finance",
      builtin: false,
      maxSteps: 10,
      enabled: true,
      createdAt: "2026-07-20T10:33:00.659Z",
      updatedAt: "2026-07-15T21:31:53.713Z",
    }));

    expect(normalized.executor).toBe("generic");
    expect(normalized.modelKey).toBe("finance");
    expect(normalized.capabilityIds).toEqual(["finance-domain"]);
  });

  it("derives finance model key from legacy executor when modelKey is absent", () => {
    const normalized = migrateLegacyExecutorAgent(parseRuntimeAgentDefinition({
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      capabilityIds: ["finance-domain"],
      executor: "finance",
      builtin: false,
      maxSteps: 10,
      enabled: true,
      createdAt: "2026-07-20T10:33:00.659Z",
      updatedAt: "2026-07-15T21:31:53.713Z",
    }));

    expect(normalized.executor).toBe("generic");
    expect(normalized.modelKey).toBe("finance");
  });

  it("applies legacy migration when loading agents through repository transformAgent", async () => {
    const rootDir = await createTempRoot();
    const repository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json", {
      transformAgent: migrateLegacyExecutorAgent,
    });

    await repository.saveAgents([parseRuntimeAgentDefinition({
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      capabilityIds: ["finance-domain"],
      executor: "finance",
      modelKey: "finance",
      builtin: false,
      maxSteps: 10,
      enabled: true,
      createdAt: "2026-07-20T10:33:00.659Z",
      updatedAt: "2026-07-15T21:31:53.713Z",
    })]);

    const agents = await repository.loadAgents();
    expect(agents[0]?.executor).toBe("generic");
  });
});
