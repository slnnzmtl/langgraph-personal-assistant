import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createCompiledSubAgentGraph } from "../helpers/compiled-sub-agent.js";
import { createRuntimeAgentNode } from "../../src/core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../src/core/execution/sub-agent-state.js";
import { hasPendingToolCalls } from "../../src/core/execution/tool-routing.js";
import { getRuntimeAgentFixture } from "../helpers/fakes.js";

class PairingCallbackHandler extends BaseCallbackHandler {
  name = "PairingCallbackHandler";

  chainStarts = 0;
  chainEnds = 0;
  llmStarts = 0;
  llmEnds = 0;
  toolStarts = 0;
  toolEnds = 0;

  orphanEnds = 0;

  async handleChainStart(): Promise<void> {
    this.chainStarts += 1;
  }

  async handleChainEnd(): Promise<void> {
    if (this.chainStarts <= this.chainEnds) {
      this.orphanEnds += 1;
    }
    this.chainEnds += 1;
  }

  async handleLLMStart(): Promise<void> {
    this.llmStarts += 1;
  }

  async handleLLMEnd(): Promise<void> {
    if (this.llmStarts <= this.llmEnds) {
      this.orphanEnds += 1;
    }
    this.llmEnds += 1;
  }

  async handleToolStart(): Promise<void> {
    this.toolStarts += 1;
  }

  async handleToolEnd(): Promise<void> {
    if (this.toolStarts <= this.toolEnds) {
      this.orphanEnds += 1;
    }
    this.toolEnds += 1;
  }
}

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const createConfigForwardingLlmNode = (
  handler: (input: unknown) => AIMessage,
  onConfig?: (config: Parameters<BaseChatModel["invoke"]>[1] | undefined) => void,
) =>
  async (state: SubAgentState, config?: Parameters<BaseChatModel["invoke"]>[1]): Promise<SubAgentStateUpdate> => {
    if (hasPendingToolCalls(state.agentMessages)) {
      return { stepCount: state.stepCount };
    }

    onConfig?.(config);

    const lastMessage = state.agentMessages[state.agentMessages.length - 1];
    const isLoopContinuation = lastMessage instanceof ToolMessage;
    const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;

    return {
      agentMessages: [handler(state.agentMessages)],
      stepCount,
    };
  };

describe("callback propagation", () => {
  it("keeps chain and tool callback start/end events paired in a compiled subgraph", async () => {
    let llmCalls = 0;
    const receivedConfigs: Array<Parameters<BaseChatModel["invoke"]>[1] | undefined> = [];
    const llmNode = createConfigForwardingLlmNode(
      () => {
        llmCalls += 1;

        if (llmCalls === 1) {
          return new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: { text: "hello" }, id: "echo-1", type: "tool_call" }],
          });
        }

        return new AIMessage("subgraph done");
      },
      (config) => {
        receivedConfigs.push(config);
      },
    );

    const handler = new PairingCallbackHandler();
    const config = { callbacks: [handler] };
    const subgraph = createCompiledSubAgentGraph("Test", 10, llmNode, [echoTool]);
    await subgraph.invoke(
      {
        agentMessages: [new HumanMessage("hello")],
        stepCount: 0,
      },
      config,
    );

    expect(receivedConfigs.length).toBeGreaterThan(0);
    expect(receivedConfigs.every((received) => received?.callbacks !== undefined)).toBe(true);
    expect(handler.chainStarts).toBeGreaterThan(0);
    expect(handler.chainStarts).toBe(handler.chainEnds);
    expect(handler.toolStarts).toBeGreaterThan(0);
    expect(handler.toolStarts).toBe(handler.toolEnds);
    expect(handler.orphanEnds).toBe(0);
  });

  it("forwards config through createRuntimeAgentNode model invokes", async () => {
    const definition = getRuntimeAgentFixture("finance");
    let receivedConfig: unknown;

    const model = {
      bindTools: () => ({
        invoke: async (_input: unknown, config?: unknown) => {
          receivedConfig = config;
          return new AIMessage("finance reply");
        },
      }),
      invoke: async (_input: unknown, config?: unknown) => {
        receivedConfig = config;
        return new AIMessage("finance reply");
      },
    } as unknown as BaseChatModel;

    const llmNode = createRuntimeAgentNode(
      model,
      definition,
      [],
    );
    const config = { callbacks: [new PairingCallbackHandler()] };
    await llmNode(
      {
        agentMessages: [new HumanMessage("show expenses")],
        stepCount: 0,
      },
      config,
    );

    expect(receivedConfig).toBe(config);
  });
});
