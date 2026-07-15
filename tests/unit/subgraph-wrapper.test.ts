import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { AgentState } from "../../src/state.js";
import { createSubgraphNodeWrapper } from "../../src/runtime-agents/execution/subgraph-wrapper.js";

describe("createSubgraphNodeWrapper", () => {
  it("returns the last AI message from the subgraph result", async () => {
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Test",
      buildInitialState: (parentState) => ({ messages: parentState.messages }),
      compiledSubgraph: {
        invoke: async () => ({
          messages: [new AIMessage("subgraph done")],
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
      buildInitialState: (parentState) => ({ messages: parentState.messages, stepCount: 0 }),
      compiledSubgraph: {
        invoke: async () => ({
          messages: [new AIMessage("ignored")],
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

  it("returns a failure message when the subgraph throws", async () => {
    const wrapper = createSubgraphNodeWrapper({
      subgraphName: "Finance",
      buildInitialState: (parentState) => ({ messages: parentState.messages }),
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
