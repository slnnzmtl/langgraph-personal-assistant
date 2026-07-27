import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  buildRuntimeAgentGraphNodeSets,
  createRuntimeAgentFinalizeNode,
  createRuntimeAgentPrepareNode,
  routeAfterRuntimeAgentLlm,
  routeAfterRuntimeAgentTools,
  type AgentState,
} from "@personal-assistant/supervisor-framework";
import { createSubAgentToolsNode } from "@personal-assistant/supervisor-framework";
import { createAgentStateAnnotation } from "@personal-assistant/supervisor-framework";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const createFlattenedRuntimeAgentGraph = () => {
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

  const bundle = {
    name: "Finance",
    maxSteps: 10,
    prepare: (parentState: AgentState) => ({
      agentMessages: parentState.messages,
      stepCount: 0,
    }),
    llmNode,
    toolsNode: createSubAgentToolsNode([echoTool]),
    finalize: (result: { agentMessages: AIMessage[]; stepCount: number }) => ({
      messages: [result.agentMessages[result.agentMessages.length - 1]!],
    }),
  };

  const agentStateAnnotation = createAgentStateAnnotation({ messageHistoryMaxTokens: 8_000 });

  return new StateGraph(agentStateAnnotation)
    .addNode("finance__prepare", createRuntimeAgentPrepareNode(bundle))
    .addNode("finance__llm", bundle.llmNode)
    .addNode("finance__tools", bundle.toolsNode)
    .addNode("finance__finalize", createRuntimeAgentFinalizeNode(bundle, "finance"))
    .addEdge(START, "finance__prepare")
    .addEdge("finance__prepare", "finance__llm")
    .addConditionalEdges(
      "finance__llm",
      (state) => routeAfterRuntimeAgentLlm(state, bundle.maxSteps, "finance__tools", "finance__finalize"),
      {
        finance__tools: "finance__tools",
        finance__finalize: "finance__finalize",
      },
    )
    .addConditionalEdges(
      "finance__tools",
      (state) => routeAfterRuntimeAgentTools(state, "finance__llm", "finance__tools"),
      {
        finance__llm: "finance__llm",
        finance__tools: "finance__tools",
      },
    )
    .addEdge("finance__finalize", END)
    .compile({ name: "flattened-runtime-agent-graph" });
};

describe("flattened runtime agent graph tracing", () => {
  const originalTracing = process.env.LANGCHAIN_TRACING_V2;
  const originalApiKey = process.env.LANGCHAIN_API_KEY;
  const originalEndpoint = process.env.LANGCHAIN_ENDPOINT;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let stub: ReturnType<typeof createServer> | undefined;

  beforeEach(async () => {
    stub = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => {
      stub!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = stub.address();
    const port = typeof address === "object" && address ? address.port : 0;

    process.env.LANGCHAIN_TRACING_V2 = "true";
    process.env.LANGCHAIN_API_KEY = "lsv2_pt_fake";
    process.env.LANGCHAIN_ENDPOINT = `http://127.0.0.1:${port}`;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    errorSpy.mockRestore();
    if (originalTracing === undefined) {
      delete process.env.LANGCHAIN_TRACING_V2;
    } else {
      process.env.LANGCHAIN_TRACING_V2 = originalTracing;
    }
    if (originalApiKey === undefined) {
      delete process.env.LANGCHAIN_API_KEY;
    } else {
      process.env.LANGCHAIN_API_KEY = originalApiKey;
    }
    if (originalEndpoint === undefined) {
      delete process.env.LANGCHAIN_ENDPOINT;
    } else {
      process.env.LANGCHAIN_ENDPOINT = originalEndpoint;
    }
    await new Promise<void>((resolve, reject) => {
      stub?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("avoids duplicate LangChainTracer end errors for flattened runtime agent loops", async () => {
    const graph = createFlattenedRuntimeAgentGraph();

    await graph.invoke({
      messages: [new HumanMessage("show latest expenses")],
      context: {},
      next: undefined,
    });

    const { awaitAllCallbacks } = await import("@langchain/core/callbacks/promises");
    await awaitAllCallbacks();

    const tracerErrors = errorSpy.mock.calls
      .flat()
      .filter((line) => typeof line === "string" && line.includes("Error in handler LangChainTracer"));

    expect(tracerErrors).toHaveLength(0);
  });
});

describe("buildRuntimeAgentGraphNodeSets", () => {
  it("creates prepare, llm, tools, and finalize node names per enabled agent", () => {
    const nodeSets = buildRuntimeAgentGraphNodeSets(
      [
        {
          id: "finance",
          name: "Finance",
          description: "Finance agent",
          systemPrompt: "finance",
          capabilityIds: ["none"],
          maxSteps: 4,
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      {
        loadPromptByKey: (key) => key,
        runtimeAgentPolicy: {
          createGraphBundle: () => ({
            name: "Finance",
            maxSteps: 4,
            prepare: () => ({ agentMessages: [], stepCount: 0 }),
            llmNode: async () => ({ agentMessages: [], stepCount: 0 }),
            toolsNode: async () => ({}),
            finalize: () => ({ messages: [new AIMessage("done")] }),
          }),
        },
      } as never,
    );

    expect(nodeSets).toHaveLength(1);
    expect(nodeSets[0]).toMatchObject({
      agentId: "finance",
      prepareNodeName: "finance__prepare",
      llmNodeName: "finance__llm",
      toolsNodeName: "finance__tools",
      finalizeNodeName: "finance__finalize",
    });
  });
});
