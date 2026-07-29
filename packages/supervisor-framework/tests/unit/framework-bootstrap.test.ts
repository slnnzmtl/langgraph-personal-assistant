import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapSupervisorSystem,
  buildDefaultRuntimeExecution,
  createAgentPolicy,
  createAssistant,
  createCapabilityCatalog,
  createCronJobRepositoryForConfig,
  createEmptySkillCatalog,
  createRuntimeAgentRepository,
  createSystemConfigCapabilityProviders,
  DATA_WRITES_DISABLED_MESSAGE,
  NONE_CAPABILITY_PROVIDER,
  resolveAgentTools,
  SYSTEM_AGENT_ID,
  SYSTEM_CONFIG_CAPABILITY_ID,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { FakeLLMConnector } from "../helpers/fakes.js";

const researcher: RuntimeAgentDefinition = {
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

describe("framework bootstrap", () => {
  it("compiles a supervisor graph from a generic pack", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);

    const runtimeAgentsFilePath = path.join(process.cwd(), ".tmp", `framework-agents-${process.pid}.json`);
    const cronJobsFilePath = path.join(process.cwd(), ".tmp", `framework-cron-${process.pid}.json`);

    const result = await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
        messageHistoryMaxTokens: 8_000,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      seedAgents: async () => [researcher],
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    expect(result.runtimeAgents).toEqual([researcher]);
    expect(result.graph.invoke).toBeTypeOf("function");
    expect(result.skillCatalog.listSkills()).toEqual([]);
  });

  it("exports createAssistant through the same compilation path", () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);

    const graph = createAssistant({
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      models: { generic: new FakeLLMConnector(() => "ok").getModel() },
      runtimeAgents: [researcher],
      runtimeAgentRepository: createRuntimeAgentRepository(process.cwd(), ".tmp/framework-test-agents.json"),
      capabilityDeps: {},
      loadPromptByKey: () => "prompt",
      loadSupervisorPrompt: () => "Supervise requests.",
      runtimeAgentPolicy: createAgentPolicy({
        resolveTools: (definition: RuntimeAgentDefinition, deps: Record<string, unknown>) =>
          resolveAgentTools(definition, catalog, deps),
      }),
    });

    expect(graph.invoke).toBeTypeOf("function");
  });

  it("uses empty skill catalog by default", () => {
    expect(createEmptySkillCatalog().listModules()).toEqual([]);
  });

  it("runs initializeDefaults before seedAgents and skill catalog creation", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const callOrder: string[] = [];
    const runtimeAgentsFilePath = path.join(process.cwd(), ".tmp", `framework-init-${process.pid}.json`);
    const cronJobsFilePath = path.join(process.cwd(), ".tmp", `framework-init-cron-${process.pid}.json`);

    await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      initializeDefaults: ({ systemAgentEnabled }) => {
        callOrder.push(`initializeDefaults:${systemAgentEnabled}`);
      },
      seedAgents: async () => {
        callOrder.push("seedAgents");
        return [researcher];
      },
      buildSkillCatalog: () => {
        callOrder.push("buildSkillCatalog");
        return createEmptySkillCatalog();
      },
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    expect(callOrder).toEqual([
      "initializeDefaults:false",
      "seedAgents",
      "buildSkillCatalog",
    ]);
  });

  it("reuses preparedRuntimeAgents instead of calling seedAgents again", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const seedAgents = vi.fn(async () => [researcher]);
    const runtimeAgentsFilePath = path.join(process.cwd(), ".tmp", `framework-prepared-${process.pid}.json`);
    const cronJobsFilePath = path.join(process.cwd(), ".tmp", `framework-prepared-cron-${process.pid}.json`);

    await bootstrapSupervisorSystem(
      {
        config: {
          runtimeAgentsFilePath,
          cronJobsFilePath,
        },
        capabilityCatalog: catalog,
        supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
        loadSupervisorPrompt: () => "Supervise requests.",
        seedAgents,
        buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
          buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
            loadPromptByKey: () => "prompt",
          }),
        buildModels: () => ({
          generic: new FakeLLMConnector(() => "ok").getModel(),
        }),
        buildCapabilityDeps: () => ({}),
      },
      { preparedRuntimeAgents: [researcher] },
    );

    expect(seedAgents).not.toHaveBeenCalled();
  });

  it("skips initializeDefaults when allowDataWrites is false", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const initializeDefaults = vi.fn();
    const runtimeAgentsFilePath = path.join(process.cwd(), ".tmp", `framework-readonly-init-${process.pid}.json`);
    const cronJobsFilePath = path.join(process.cwd(), ".tmp", `framework-readonly-init-cron-${process.pid}.json`);

    await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
        allowDataWrites: false,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      initializeDefaults,
      seedAgents: async () => [researcher],
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    expect(initializeDefaults).not.toHaveBeenCalled();
  });

  it("skips purgeLegacySystemAgent when allowDataWrites is false", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const rootDir = path.join(process.cwd(), ".tmp", `framework-readonly-purge-${process.pid}`);
    const relativePath = "data/runtime-agents.json";
    const runtimeAgentsFilePath = path.join(rootDir, relativePath);
    const repository = createRuntimeAgentRepository(rootDir, relativePath);
    const saveAgents = vi.spyOn(repository, "saveAgents");

    await mkdir(path.dirname(runtimeAgentsFilePath), { recursive: true });
    await writeFile(
      runtimeAgentsFilePath,
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
        ],
      }, null, 2)}\n`,
      { flag: "w" },
    );

    await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath: path.join(rootDir, "data/cron-jobs.json"),
        allowDataWrites: false,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      systemAgent: { modelKey: "configuration" },
      createRuntimeAgentRepository: () => repository,
      seedAgents: async () => [researcher],
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    expect(saveAgents).not.toHaveBeenCalled();
  });

  it("wraps runtime-agent repository in read-only mode when allowDataWrites is false", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const runtimeAgentsFilePath = path.join(
      process.cwd(),
      ".tmp",
      `framework-readonly-agents-${process.pid}.json`,
    );
    const cronJobsFilePath = path.join(
      process.cwd(),
      ".tmp",
      `framework-readonly-agents-cron-${process.pid}.json`,
    );

    const result = await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
        allowDataWrites: false,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      systemAgent: { modelKey: "configuration" },
      seedAgents: async () => [researcher],
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    const agents = await result.runtimeAgentRepository.loadAgents();
    expect(agents.some((agent) => agent.id === SYSTEM_AGENT_ID)).toBe(true);

    await expect(result.runtimeAgentRepository.saveAgents([])).rejects.toThrow(
      DATA_WRITES_DISABLED_MESSAGE,
    );
    await expect(
      result.runtimeAgentRepository.createAgent({
        name: "Blocked",
        description: "Should fail",
        systemPrompt: "Prompt",
        capabilityIds: ["none"],
      }),
    ).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
  });

  it("wraps cron repository in read-only mode when allowDataWrites is false", async () => {
    const catalog = createCapabilityCatalog([NONE_CAPABILITY_PROVIDER]);
    const runtimeAgentsFilePath = path.join(
      process.cwd(),
      ".tmp",
      `framework-readonly-cron-${process.pid}.json`,
    );
    const cronJobsFilePath = path.join(
      process.cwd(),
      ".tmp",
      `framework-readonly-cron-jobs-${process.pid}.json`,
    );

    const result = await bootstrapSupervisorSystem({
      config: {
        runtimeAgentsFilePath,
        cronJobsFilePath,
        allowDataWrites: false,
      },
      capabilityCatalog: catalog,
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      loadSupervisorPrompt: () => "Supervise requests.",
      createCronJobRepository: (filePath, cronTargetAgentIds) =>
        createCronJobRepositoryForConfig(filePath, cronTargetAgentIds),
      seedAgents: async () => [researcher],
      buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
        buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
          loadPromptByKey: () => "prompt",
        }),
      buildModels: () => ({
        generic: new FakeLLMConnector(() => "ok").getModel(),
      }),
      buildCapabilityDeps: () => ({}),
    });

    await expect(result.cronJobRepository.loadJobs()).resolves.toEqual([]);

    await expect(
      result.cronJobRepository.createJob({
        jobName: "blocked-job",
        schedule: "0 9 * * *",
        targetRoute: "researcher",
      }),
    ).rejects.toThrow(DATA_WRITES_DISABLED_MESSAGE);
  });

  it("rejects non-grantable capabilities on persisted agents at bootstrap", async () => {
    const catalog = createCapabilityCatalog([
      NONE_CAPABILITY_PROVIDER,
      ...createSystemConfigCapabilityProviders(),
    ]);
    const tamperedAgent: RuntimeAgentDefinition = {
      ...researcher,
      id: "evil",
      capabilityIds: [SYSTEM_CONFIG_CAPABILITY_ID],
    };

    await expect(
      bootstrapSupervisorSystem({
        config: {
          runtimeAgentsFilePath: path.join(process.cwd(), ".tmp", `framework-evil-${process.pid}.json`),
          cronJobsFilePath: path.join(process.cwd(), ".tmp", `framework-evil-cron-${process.pid}.json`),
        },
        capabilityCatalog: catalog,
        supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
        loadSupervisorPrompt: () => "Supervise requests.",
        systemAgent: { modelKey: "configuration" },
        seedAgents: async () => [tamperedAgent],
        buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
          buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
            loadPromptByKey: () => "prompt",
          }),
        buildModels: () => ({
          generic: new FakeLLMConnector(() => "ok").getModel(),
        }),
        buildCapabilityDeps: () => ({
          cronJobRepository: {},
          runtimeAgentRepository: {},
        }),
      }),
    ).rejects.toThrow(/cannot be granted|not grantable|Invalid capability|unavailable/i);
  });
});
