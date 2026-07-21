import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "../../src/core/state.js";
import { createSubgraphNodeWrapper } from "../../src/core/execution/subgraph-wrapper.js";

describe("createSubgraphNodeWrapper", () => {
  it("returns the last AI message from the subgraph result", async () => {
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Test",
      buildInitialState: (parentState) => ({ agentMessages: parentState.messages }),
      compiledSubgraph: {
        invoke: async () => ({
          agentMessages: [new AIMessage("subgraph done")],
        }),
      },
    });

    const result = await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("subgraph done");
  });

  it("uses mapResult when provided", async () => {
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Test",
      buildInitialState: (parentState) => ({ agentMessages: parentState.messages, stepCount: 0 }),
      compiledSubgraph: {
        invoke: async () => ({
          agentMessages: [new AIMessage("ignored")],
          stepCount: 3,
        }),
      },
      mapResult: (result) => ({
        messages: [new AIMessage(`steps: ${result.stepCount}`)],
      }),
    });

    const result = await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    });

    expect(result.messages?.[0]?.content).toBe("steps: 3");
  });

  it("forwards RunnableConfig to the compiled subgraph invoke", async () => {
    const config = { callbacks: [] };
    const invoke = vi.fn().mockResolvedValue({
      agentMessages: [new AIMessage("done")],
    });
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Test",
      buildInitialState: (parentState) => ({ agentMessages: parentState.messages }),
      compiledSubgraph: { invoke },
    });

    await wrapper({
      messages: [new HumanMessage("hello")],
      context: {},
      next: undefined,
    }, config);

    expect(invoke).toHaveBeenCalledWith(
      { agentMessages: [new HumanMessage("hello")] },
      config,
    );
  });

  it("returns a failure message when the subgraph throws", async () => {
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Finance",
      buildInitialState: (parentState) => ({ agentMessages: parentState.messages }),
      compiledSubgraph: {
        invoke: async () => {
          throw new Error("boom");
        },
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
