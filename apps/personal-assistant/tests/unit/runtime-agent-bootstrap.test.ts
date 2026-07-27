import os from "node:os";
import path from "node:path";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  createRuntimeAgentRepository,
  isRuntimeAgentBuiltin,
  wrapRepositoryWithSystemAgent,
} from "@personal-assistant/supervisor-framework";
import { applyIntegrationAvailability } from "../../src/composition/runtime-agent-defaults.js";
import { buildLocalModuleAgents } from "../helpers/runtime-agent-fixtures.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })));
});

const createWrappedRepository = async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "pa-runtime-bootstrap-"));
  tempPaths.push(rootDir);
  const repository = wrapRepositoryWithSystemAgent(
    createRuntimeAgentRepository(rootDir, "data/runtime-agents.json"),
    {
      modelKey: "configuration",
    },
  );

  return { rootDir, repository };
};

describe("wrapRepositoryWithSystemAgent", () => {
  it("returns the code-seeded configuration agent when the store is empty", async () => {
    const { repository } = await createWrappedRepository();

    const agents = await repository.loadAgents();

    expect(agents.map((agent) => agent.id)).toEqual(["configuration"]);
    expect(agents.find((agent) => agent.id === "configuration")?.modelKey).toBe("configuration");
    expect(isRuntimeAgentBuiltin(agents.find((agent) => agent.id === "configuration")!)).toBe(true);
    expect(agents.find((agent) => agent.id === "configuration")?.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("does not persist the configuration agent to disk on load", async () => {
    const { rootDir, repository } = await createWrappedRepository();

    await repository.loadAgents();

    const filePath = path.join(rootDir, "data/runtime-agents.json");
    await expect(access(filePath)).rejects.toThrow();
  });

  it("normalizes legacy executors when loading persisted agents", async () => {
    const { rootDir, repository } = await createWrappedRepository();

    await mkdir(path.join(rootDir, "data"), { recursive: true });
    await writeFile(
      path.join(rootDir, "data/runtime-agents.json"),
      `${JSON.stringify({
        version: 1,
        agents: [{
          id: "obsidian",
          name: "Obsidian",
          description: "Vault agent",
          systemPrompt: "Obsidian prompt",
          capabilityIds: ["obsidian-vault"],
          executor: "obsidian",
          builtin: false,
          maxSteps: 8,
          enabled: true,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
        }],
      }, null, 2)}\n`,
    );

    const agents = await repository.loadAgents();
    const obsidian = agents.find((agent) => agent.id === "obsidian");

    expect(obsidian?.modelKey).toBe("obsidian");
    expect("executor" in (obsidian ?? {})).toBe(false);
  });

  it("preserves local module agents from persistence", async () => {
    const { repository } = await createWrappedRepository();

    await repository.saveAgents(buildLocalModuleAgents());

    const agents = await repository.loadAgents();

    expect(agents.map((agent) => agent.id)).toEqual(["configuration", "finance", "obsidian"]);
    expect(agents.find((agent) => agent.id === "finance")?.modelKey).toBe("finance");
  });

  it("does not purge legacy configuration rows until purgeLegacySystemAgent runs", async () => {
    const { rootDir, repository } = await createWrappedRepository();
    const rawRepository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await rawRepository.saveAgents([createSystemAgentDefinition({
      modelKey: "configuration",
    })]);

    await repository.loadAgents();
    expect((await rawRepository.loadAgents()).map((agent) => agent.id)).toEqual(["configuration"]);
  });

  it("strips legacy configuration rows from persistence without touching local modules", async () => {
    const { rootDir, repository } = await createWrappedRepository();
    const rawRepository = createRuntimeAgentRepository(rootDir, "data/runtime-agents.json");

    await mkdir(path.join(rootDir, "data"), { recursive: true });
    await writeFile(
      path.join(rootDir, "data/runtime-agents.json"),
      `${JSON.stringify({
        version: 1,
        agents: [
          {
            id: "configuration",
            name: "Configuration",
            description: "legacy",
            systemPrompt: "legacy",
            capabilityIds: ["system-config"],
            executor: "configuration",
            modelKey: "configuration",
            builtin: true,
            maxSteps: 10,
            enabled: true,
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          {
            id: "obsidian",
            name: "Obsidian",
            description: "local description",
            systemPrompt: "local prompt",
            capabilityIds: ["obsidian-vault"],
            executor: "obsidian",
            builtin: false,
            maxSteps: 8,
            enabled: true,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
          },
        ],
      }, null, 2)}\n`,
      { flag: "w" },
    );

    await repository.purgeLegacySystemAgent();
    const agents = await repository.loadAgents();
    const configuration = agents.find((agent) => agent.id === "configuration");
    const obsidian = agents.find((agent) => agent.id === "obsidian");
    const persisted = await rawRepository.loadAgents();

    expect(configuration?.description).toBe("Manage cron jobs, agent skills, and reusable runtime sub-agents.");
    expect(configuration?.enabled).toBe(true);
    expect(obsidian?.description).toBe("local description");
    expect(obsidian?.maxSteps).toBe(8);
    expect(persisted.map((agent) => agent.id)).toEqual(["obsidian"]);
  });

  it("rejects updates to the virtual configuration agent", async () => {
    const { repository } = await createWrappedRepository();

    await expect(
      repository.updateAgent("configuration", { enabled: false }),
    ).rejects.toThrow("Cannot update built-in runtime agent: configuration");
  });

  it("rejects creating a runtime agent with the reserved configuration id", async () => {
    const { repository } = await createWrappedRepository();

    await expect(
      repository.createAgent({
        name: "Configuration",
        description: "Reserved id collision",
        systemPrompt: "Should not persist",
        capabilityIds: ["none"],
      }),
    ).rejects.toThrow("Cannot create runtime agent with reserved id: configuration");
  });
});

describe("applyIntegrationAvailability", () => {
  it("disables finance-domain agents when Supabase is unavailable", () => {
    const agents = applyIntegrationAvailability(buildLocalModuleAgents(), { supabaseAvailable: false });

    const financeAgent = agents.find((agent) => agent.capabilityIds.includes("finance-domain"));
    const obsidianAgent = agents.find((agent) => agent.capabilityIds.includes("obsidian-vault"));

    expect(financeAgent?.enabled).toBe(false);
    expect(obsidianAgent?.enabled).toBe(true);
  });
});
