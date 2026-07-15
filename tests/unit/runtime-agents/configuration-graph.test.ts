import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { configurationPolicy } from "../../../src/runtime-agents/policies/configuration/policy.js";
import { createConfigurationNode } from "../../../src/runtime-agents/policies/configuration/node.js";
import { createConfigurationSkillScopedTools } from "../../../src/runtime-agents/policies/configuration/tools.js";
import { createCompiledSubAgentGraph } from "../../../src/runtime-agents/execution/create-sub-agent.js";
import {
  FakeLLMConnector,
  createRuntimeAgentRepositoryFake,
  createRuntimeExecutionContextFake,
  defaultConfigurationBundleDeps,
  getBuiltinRuntimeAgentDefinition,
} from "../../helpers/fakes.js";

const configurationDefinition = getBuiltinRuntimeAgentDefinition("configuration");

const createRepository = () => ({
  loadJobs: vi.fn(async () => []),
  saveJobs: vi.fn(),
});

describe("configuration subgraph", () => {
  it("executes tool calls before returning to the parent wrapper", async () => {
    const repository = createRepository();
    const tools = createConfigurationSkillScopedTools(
      repository as never,
      createRuntimeAgentRepositoryFake(),
      defaultConfigurationBundleDeps,
    );
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
                targetRoute: "Obsidian_SG",
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
    const wrapper = configurationPolicy.createHandler(context, configurationDefinition);

    const result = await wrapper({
      messages: [new HumanMessage("set up a cron job for daily notes")],
      context: {},
      next: undefined,
    });

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
      repository: createRepository() as never,
      definition: configurationDefinition,
    });

    const update = await configNode({
      messages: [
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
    expect(update.messages).toBeUndefined();
    expect(update.stepCount).toBe(1);
  });

  it("prompts the model once after all parallel tool calls finish", async () => {
    const repository = createRepository();
    const tools = createConfigurationSkillScopedTools(
      repository as never,
      createRuntimeAgentRepositoryFake(),
      defaultConfigurationBundleDeps,
    );
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
      repository: repository as never,
      definition: configurationDefinition,
    });
    const subgraph = createCompiledSubAgentGraph("Configuration", 10, configNode, tools);
    const result = await subgraph.invoke({
      messages: [new HumanMessage("update cron jobs")],
      stepCount: 0,
    });

    expect(configCalls).toBeGreaterThanOrEqual(2);
    expect(result.messages.at(-1)?.content).toBe("Configuration updated.");
  });
});
