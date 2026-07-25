import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  bootstrapSupervisorSystem,
  createAgentPolicy,
  createAssistant,
  createCapabilityCatalog,
  createEmptySkillCatalog,
  createPolicyRegistry,
  createRuntimeAgentRepository,
  resolveAgentTools,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import { FakeLLMConnector } from "../helpers/fakes.js";

const researcher: RuntimeAgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Answer factual questions.",
  systemPrompt: "You are a concise research assistant.",
  capabilityIds: ["none"],
  executor: "generic",
  builtin: false,
  maxSteps: 6,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("framework bootstrap", () => {
  it("compiles a supervisor graph from a generic pack", async () => {
    const catalog = createCapabilityCatalog([
      {
        descriptor: { id: "none", description: "Prompt-only agent.", configurable: true },
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
      buildPolicyRegistry: () => ({
        loadPromptByKey: async () => "prompt",
        policies: [
          createAgentPolicy({
            executor: "generic",
            resolveTools: (definition, deps) =>
              resolveAgentTools(definition, catalog, deps, {}),
          }),
        ],
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
        descriptor: { id: "none", description: "Prompt-only agent.", configurable: true },
        resolveTools: () => [],
      },
    ]);

    const graph = createAssistant({
      supervisorLlm: new FakeLLMConnector(() => ({ next: "FINISH", reply: "ok" })),
      models: { generic: new FakeLLMConnector(() => "ok").getModel() },
      runtimeAgents: [researcher],
      runtimeAgentRepository: createRuntimeAgentRepository(process.cwd(), ".tmp/framework-test-agents.json"),
      capabilityDeps: {},
      loadPromptByKey: async () => "prompt",
      loadSupervisorPrompt: () => "Supervise requests.",
      policyRegistry: createPolicyRegistry([
        createAgentPolicy({
          executor: "generic",
          resolveTools: (definition, deps) =>
            resolveAgentTools(definition, catalog, deps, {}),
        }),
      ]),
    });

    expect(graph.invoke).toBeTypeOf("function");
  });

  it("uses empty skill catalog by default", () => {
    expect(createEmptySkillCatalog().listModules()).toEqual([]);
  });
});
