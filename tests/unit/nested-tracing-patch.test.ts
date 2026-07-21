import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createCompiledSubAgentGraph } from "../../src/core/execution/create-sub-agent.js";
import { createSubgraphNodeWrapper } from "../../src/core/execution/subgraph-wrapper.js";
import { createAgentStateAnnotation } from "../../src/core/state.js";
import { patchCallbackManagerForNestedTracing } from "../../src/core/tracing/patch-callback-manager.js";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const createNestedTracingGraph = () => {
  let llmCalls = 0;
  const llmNode = async () => {
    llmCalls += 1;

    if (llmCalls === 1) {
      return {
        agentMessages: [
          new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: { text: "hello" }, id: "echo-1", type: "tool_call" }],
          }),
        ],
        stepCount: 1,
      };
    }

    return {
      agentMessages: [new AIMessage("done")],
      stepCount: 2,
    };
  };

  const compiledSubgraph = createCompiledSubAgentGraph("Finance", 10, llmNode, [echoTool]);
  const runtimeNode = createSubgraphNodeWrapper({
    subgraphName: "Finance",
    buildInitialState: (parentState) => ({
      agentMessages: parentState.messages,
      stepCount: 0,
    }),
    compiledSubgraph,
  });

  const agentStateAnnotation = createAgentStateAnnotation({ messageHistoryMaxTokens: 8_000 });

  return new StateGraph(agentStateAnnotation)
    .addNode("Runtime_SG", runtimeNode)
    .addEdge(START, "Runtime_SG")
    .addEdge("Runtime_SG", END)
    .compile({ name: "parent-graph" });
};

describe("patchCallbackManagerForNestedTracing", () => {
  const originalTracing = process.env.LANGCHAIN_TRACING_V2;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.LANGCHAIN_TRACING_V2 = "true";
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    patchCallbackManagerForNestedTracing();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (originalTracing === undefined) {
      delete process.env.LANGCHAIN_TRACING_V2;
    } else {
      process.env.LANGCHAIN_TRACING_V2 = originalTracing;
    }
  });

  it("avoids duplicate LangChainTracer end errors for nested compiled subgraph invokes", async () => {
    const graph = createNestedTracingGraph();

    await graph.invoke({
      messages: [new HumanMessage("show latest expenses")],
      context: {},
      next: undefined,
    });

    const tracerErrors = errorSpy.mock.calls
      .flat()
      .filter((line) => typeof line === "string" && line.includes("Error in handler LangChainTracer"));

    expect(tracerErrors).toHaveLength(0);
  });
});
