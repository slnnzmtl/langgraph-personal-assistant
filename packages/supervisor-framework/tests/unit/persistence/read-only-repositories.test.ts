import { describe, expect, it, vi } from "vitest";

import {
  createReadOnlyCronJobRepository,
  createReadOnlyRuntimeAgentRepository,
  DATA_WRITES_DISABLED_MESSAGE,
  type CronJobRepository,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
} from "@personal-assistant/supervisor-framework";

const sampleAgent: RuntimeAgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Answer factual questions.",
  systemPrompt: "You are a concise research assistant.",
  capabilityIds: ["none"],
  maxSteps: 6,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("createReadOnlyRuntimeAgentRepository", () => {
  const writable: RuntimeAgentRepository = {
    loadAgents: vi.fn(async () => [sampleAgent]),
    getAgent: vi.fn(async () => sampleAgent),
    saveAgents: vi.fn(async () => undefined),
    createAgent: vi.fn(async () => sampleAgent),
    updateAgent: vi.fn(async () => sampleAgent),
    deleteAgent: vi.fn(async () => sampleAgent),
  };

  it("delegates reads to the underlying repository", async () => {
    const readOnly = createReadOnlyRuntimeAgentRepository(writable);

    await expect(readOnly.loadAgents()).resolves.toEqual([sampleAgent]);
    await expect(readOnly.getAgent("researcher")).resolves.toEqual(sampleAgent);
  });

  it("rejects mutating methods", async () => {
    const readOnly = createReadOnlyRuntimeAgentRepository(writable);

    await expect(readOnly.saveAgents([])).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
    await expect(
      readOnly.createAgent({
        name: "New",
        description: "New agent",
        systemPrompt: "Prompt",
        capabilityIds: ["none"],
      }),
    ).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
    await expect(
      readOnly.updateAgent("researcher", { description: "Updated" }),
    ).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
    await expect(readOnly.deleteAgent("researcher")).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
  });
});

describe("createReadOnlyCronJobRepository", () => {
  const sampleJob = {
    jobName: "daily-report",
    schedule: "0 9 * * *",
    targetRoute: "researcher",
  };

  const writable: CronJobRepository = {
    loadJobs: vi.fn(async () => [sampleJob]),
    saveJobs: vi.fn(async () => undefined),
    createJob: vi.fn(async (job) => job),
    deleteJob: vi.fn(async () => sampleJob),
  };

  it("delegates loadJobs to the underlying repository", async () => {
    const readOnly = createReadOnlyCronJobRepository(writable);

    await expect(readOnly.loadJobs()).resolves.toEqual([sampleJob]);
  });

  it("rejects mutating methods", async () => {
    const readOnly = createReadOnlyCronJobRepository(writable);

    await expect(readOnly.saveJobs([])).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
    await expect(readOnly.createJob(sampleJob)).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
    await expect(readOnly.deleteJob("daily-report")).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
  });
});
