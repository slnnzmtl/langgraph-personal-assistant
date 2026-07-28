import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapSupervisorSystem,
  createAgentPolicy,
  createAssistant,
  createCapabilityCatalog,
  createEmptySkillCatalog,
  createRuntimeAgentRepository,
  resolveAgentTools,
  type RuntimeAgentDefinition,
  type SkillCatalog,
  type CapabilityCatalog,
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
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Prompt-only agent.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
    ]);

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
      buildRuntimeExecution: (
        _agents: RuntimeAgentDefinition[],
        _skillCatalog: SkillCatalog,
        ctx: { capabilityCatalog: CapabilityCatalog },
      ) => ({
        loadPromptByKey: () => "prompt",
        runtimeAgentPolicy: createAgentPolicy({
          resolveTools: (definition: RuntimeAgentDefinition, deps: Record<string, unknown>) =>
            resolveAgentTools(definition, ctx.capabilityCatalog, deps),
        }),
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
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Prompt-only agent.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
    ]);

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
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Prompt-only agent.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
    ]);
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
      buildRuntimeExecution: (
        _agents: RuntimeAgentDefinition[],
        _skillCatalog: SkillCatalog,
        ctx: { capabilityCatalog: CapabilityCatalog },
      ) => ({
        loadPromptByKey: () => "prompt",
        runtimeAgentPolicy: createAgentPolicy({
          resolveTools: (definition: RuntimeAgentDefinition, deps: Record<string, unknown>) =>
            resolveAgentTools(definition, ctx.capabilityCatalog, deps),
        }),
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
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Prompt-only agent.", grantable: true },
        isAvailable: () => true,
        resolveTools: () => [],
      },
    ]);
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
        buildRuntimeExecution: (
          _agents: RuntimeAgentDefinition[],
          _skillCatalog: SkillCatalog,
          ctx: { capabilityCatalog: CapabilityCatalog },
        ) => ({
          loadPromptByKey: () => "prompt",
          runtimeAgentPolicy: createAgentPolicy({
            resolveTools: (definition: RuntimeAgentDefinition, deps: Record<string, unknown>) =>
              resolveAgentTools(definition, ctx.capabilityCatalog, deps),
          }),
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
});
