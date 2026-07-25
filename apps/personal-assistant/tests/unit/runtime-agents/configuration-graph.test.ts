import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createDefaultRuntimeShellFormatters } from "../../../src/app/register-defaults.js";
import { createConfigurationPolicy } from "../../../src/app/policies/index.js";
import { createPersonalResolveTools } from "../../../src/app/composition/personal-resolve-tools.js";
import { createConfigurationNode } from "../../helpers/policy-nodes.js";
import { createConfigurationTools, createCronRepositoryFake } from "../../helpers/configuration-tools.js";
import { createCompiledSubAgentGraph } from "../../helpers/compiled-sub-agent.js";
import {
  FakeLLMConnector,
  createRuntimeExecutionContextFake,
  getRuntimeAgentFixture,
} from "../../helpers/fakes.js";

import { createSkillCatalog } from "../../../src/runtime-agents/skills/skill-catalog.js";
import { createDefaultCapabilityCatalog } from "../../../src/runtime-agents/builtin-capabilities.js";

const capabilityCatalog = createDefaultCapabilityCatalog();
const resolveTools = createPersonalResolveTools(capabilityCatalog);
const configurationShellFormatters = createDefaultRuntimeShellFormatters(createSkillCatalog());

const configurationDefinition = getRuntimeAgentFixture("configuration");

describe("configuration subgraph", () => {
  it("executes tool calls before returning to the parent wrapper", async () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    let configCalls = 0;

    const llmConnector = new FakeLLMConnector(() => {
      configCalls += 1;

      if (configCalls === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
        });
      }

      if (configCalls === 2) {
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "create_cron_job",
              args: {
                jobName: "daily-note",
                schedule: "0 6 * * *",
                targetRoute: "obsidian",
                payload: "Create my daily note",
              },
              id: "config-tool-1",
              type: "tool_call",
            },
          ],
        });
      }

      return new AIMessage("Created cron job daily-note.");
    });

    const context = createRuntimeExecutionContextFake({
      cronJobRepository: repository as never,
      llmConnector,
    });
    const bundle = createConfigurationPolicy({
      shellFormatters: configurationShellFormatters,
      capabilityCatalog,
      resolveTools,
    })
      .createGraphBundle(context, configurationDefinition);
    const prepared = bundle.prepare({
      messages: [new HumanMessage("set up a cron job for daily notes")],
      context: {},
      next: undefined,
      agentMessages: [],
      stepCount: 0,
    });
    const compiled = createCompiledSubAgentGraph(
      "Configuration",
      configurationDefinition.maxSteps,
      bundle.llmNode,
      createConfigurationTools(repository),
    );
    const subgraphResult = await compiled.invoke(prepared);
    const result = bundle.finalize(subgraphResult);

    expect(configCalls).toBeGreaterThanOrEqual(2);
    expect(result.messages?.[0]?.content).toContain("Created cron job");
  });

  it("skips the LLM when tool calls are still pending", async () => {
    let configCalls = 0;
    const model = new FakeLLMConnector(() => {
      configCalls += 1;
      return new AIMessage("should not run");
    }).getModel();
    const configNode = createConfigurationNode(model, [], {
      repository: createCronRepositoryFake(),
      definition: configurationDefinition,
    });

    const update = await configNode({
      agentMessages: [
        new HumanMessage("create a cron job"),
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "create_cron_job", args: {}, id: "partial-1", type: "tool_call" },
            { name: "list_cron_jobs", args: {}, id: "partial-2", type: "tool_call" },
          ],
        }),
        new ToolMessage({ tool_call_id: "partial-1", content: "ok" }),
      ],
      stepCount: 1,
    });

    expect(configCalls).toBe(0);
    expect(update.agentMessages).toBeUndefined();
    expect(update.stepCount).toBe(1);
  });

  it("prompts the model once after all parallel tool calls finish", async () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    let configCalls = 0;

    const model = new FakeLLMConnector((input) => {
      configCalls += 1;

      if (configCalls === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
        });
      }

      if (configCalls === 2) {
        return new AIMessage({
          content: "",
          tool_calls: [
            { name: "list_cron_jobs", args: {}, id: "batch-1", type: "tool_call" },
            { name: "create_cron_job", args: {}, id: "batch-2", type: "tool_call" },
          ],
        });
      }

      const toolResults = input.filter((message: { _getType?: () => string }) => message._getType?.() === "tool");
      expect(toolResults.length).toBeGreaterThanOrEqual(2);

      return new AIMessage("Configuration updated.");
    }).getModel();

    const configNode = createConfigurationNode(model, tools, {
      repository,
      definition: configurationDefinition,
    });
    const subgraph = createCompiledSubAgentGraph("Configuration", 10, configNode, tools);
    const result = await subgraph.invoke({
      agentMessages: [new HumanMessage("update cron jobs")],
      stepCount: 0,
    });

    expect(configCalls).toBeGreaterThanOrEqual(2);
    expect(result.agentMessages.at(-1)?.content).toBe("Configuration updated.");
  });
});
