import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createSubAgentGraphBundle } from "../../src/core/execution/create-sub-agent.js";
import { createCompiledSubAgentGraph } from "../helpers/compiled-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../src/core/execution/sub-agent-state.js";
import { hasPendingToolCalls } from "../../src/core/execution/tool-routing.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const createTestLlmNode = (handler: (input: unknown) => AIMessage) => {
  const model = new FakeLLMConnector(handler).getModel();

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    if (hasPendingToolCalls(state.agentMessages)) {
      return { stepCount: state.stepCount };
    }

    const response = await model.invoke(state.agentMessages);

    return {
      agentMessages: [response as AIMessage],
      stepCount: 1,
    };
  };
};

describe("createCompiledSubAgentGraph", () => {
  it("runs llm to tools to llm loop", async () => {
    let llmCalls = 0;
    const llmNode = createTestLlmNode((input) => {
      llmCalls += 1;

      if (llmCalls === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ name: "echo", args: { text: "hello" }, id: "echo-1", type: "tool_call" }],
        });
      }

      const toolResults = (input as { _getType?: () => string }[]).filter(
        (message) => message._getType?.() === "tool",
      );
      expect(toolResults).toHaveLength(1);

      return new AIMessage("subgraph done");
    });

    const subgraph = createCompiledSubAgentGraph("Test", 10, llmNode, [echoTool]);
    const result = await subgraph.invoke({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(llmCalls).toBe(2);
    expect(result.agentMessages.at(-1)?.content).toBe("subgraph done");
  });
});

describe("createSubAgentGraphBundle", () => {
  it("maps subgraph results through finalize", () => {
    const bundle = createSubAgentGraphBundle({
      name: "Test",
      maxSteps: 3,
      deps: {},
      createTools: () => [],
      createLlmNode: () => async () => ({
        agentMessages: [new AIMessage("ignored")],
        stepCount: 3,
      }),
      mapResult: (result, { maxSteps }) => ({
        messages: [new AIMessage(`steps: ${result.stepCount}/${maxSteps}`)],
      }),
    });

    const finalized = bundle.finalize({
      agentMessages: [new AIMessage("ignored")],
      stepCount: 3,
    });

    const messages = finalized.messages;
    expect(Array.isArray(messages) ? messages[0]?.content : undefined).toBe("steps: 3/3");
  });
});
