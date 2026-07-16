import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createSubAgent, createCompiledSubAgentGraph } from "../../src/core/execution/create-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../src/core/execution/sub-agent-state.js";
import { hasPendingToolCalls } from "../../src/tools/routing.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const createTestLlmNode = (handler: (input: unknown) => AIMessage) => {
  const model = new FakeLLMConnector(handler).getModel();

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    if (hasPendingToolCalls(state.messages)) {
      return { stepCount: state.stepCount };
    }

    const lastMessage = state.messages[state.messages.length - 1];
    const isLoopContinuation = lastMessage instanceof ToolMessage;
    const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;
    const response = await model.invoke(state.messages);

    return {
      messages: [response as AIMessage],
      stepCount,
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
      messages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(llmCalls).toBe(2);
    expect(result.messages.at(-1)?.content).toBe("subgraph done");
  });

  it("terminates when maxSteps is reached", async () => {
    const llmNode = createTestLlmNode(() =>
      new AIMessage({
        content: "",
        tool_calls: [{ name: "echo", args: { text: "loop" }, id: "echo-1", type: "tool_call" }],
      }),
    );

    const subgraph = createCompiledSubAgentGraph("Test", 1, llmNode, [echoTool]);
    const result = await subgraph.invoke({
      messages: [new HumanMessage("loop forever")],
      stepCount: 0,
    });

    expect(result.stepCount).toBe(1);
    expect(result.messages.at(-1)).toBeInstanceOf(AIMessage);
    expect((result.messages.at(-1) as AIMessage).tool_calls?.length).toBeGreaterThan(0);
  });
});

describe("createSubAgent", () => {
  it("returns the last AI message from the subgraph result", async () => {
    const wrapper = createSubAgent({
      name: "Test",
      maxSteps: 10,
      deps: {},
      createTools: () => [],
      createLlmNode: () => async () => ({
        messages: [new AIMessage("subgraph done")],
        stepCount: 1,
      }),
    });

    const result = await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("subgraph done");
  });

  it("uses mapResult when provided", async () => {
    const wrapper = createSubAgent({
      name: "Test",
      maxSteps: 3,
      deps: {},
      createTools: () => [],
      createLlmNode: () => async () => ({
        messages: [new AIMessage("ignored")],
        stepCount: 3,
      }),
      mapResult: (result, { maxSteps }) => ({
        messages: [new AIMessage(`steps: ${result.stepCount}/${maxSteps}`)],
      }),
    });

    const result = await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("steps: 3/3");
  });

  it("returns a failure message when the subgraph throws", async () => {
    const wrapper = createSubAgent({
      name: "Finance",
      maxSteps: 10,
      deps: {},
      createTools: () => [],
      createLlmNode: () => async () => {
        throw new Error("boom");
      },
    });

    const result = await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("Finance sub-graph failed: boom");
  });
});
