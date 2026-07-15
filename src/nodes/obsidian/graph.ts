import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AgentStateUpdate } from "../../state.js";
import { reduceAgentMessages } from "../../state.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { createSubgraphNodeWrapper } from "../subgraph-wrapper.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import { createObsidianNode, createObsidianTools } from "./index.js";

export const OBSIDIAN_MAX_STEPS = 8;

export const ObsidianSubgraphStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  obsidianStepCount: Annotation<number>({
    reducer: (_current: number, update: number) => update,
    default: () => 0,
  }),
});

export type ObsidianSubgraphState = typeof ObsidianSubgraphStateAnnotation.State;

const lastMessageHasToolCalls = (state: ObsidianSubgraphState): boolean =>
  lastMessageRequestsTools(state.messages);

export const createCompiledObsidianSubgraph = (llmConnector: { getModel(): BaseChatModel }, vaultRoot: string, fileSender?: IFileSender) => {
  const tools = createObsidianTools(vaultRoot, fileSender);
  
  const obsidianNode = createObsidianNode(llmConnector, vaultRoot, tools);
  const obsidianToolsNode = new ToolNode(tools);

  const incrementStepCounter = async (state: ObsidianSubgraphState) => {
    return { obsidianStepCount: state.obsidianStepCount + 1 };
  };

  const graph = new StateGraph(ObsidianSubgraphStateAnnotation)
    .addNode("llm", obsidianNode)
    .addNode("tools", obsidianToolsNode)
    .addNode("incrementCounter", incrementStepCounter)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: ObsidianSubgraphState) => {
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }

      if (!lastMessageHasToolCalls(state)) {
        return END;
      }

      if (state.obsidianStepCount >= OBSIDIAN_MAX_STEPS) {
        return END;
      }

      return "tools";
    })
    .addConditionalEdges("tools", (state: ObsidianSubgraphState) => {
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }

      return "incrementCounter";
    })
    .addEdge("incrementCounter", "llm");

  return graph.compile({ name: "obsidian-subgraph" });
};

/**
 * @param llmConnector LLM connector with getModel() method
 * @param vaultRoot Root directory of the Obsidian vault
 * @returns A node function that takes AgentState and returns AgentStateUpdate
 */
export const createObsidianSubgraphWrapper = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
  fileSender?: IFileSender,
) => {
  const compiledSubgraph = createCompiledObsidianSubgraph(llmConnector, vaultRoot, fileSender);

  return createSubgraphNodeWrapper<ObsidianSubgraphState>({
    subgraphName: "Obsidian",
    buildInitialState: (parentState) => ({
      messages: parentState.messages,
      obsidianStepCount: 0,
    }),
    compiledSubgraph,
    mapResult: (result): AgentStateUpdate => {
      if (result.obsidianStepCount >= OBSIDIAN_MAX_STEPS) {
        return {
          messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${OBSIDIAN_MAX_STEPS} Obsidian tool steps.`)],
        };
      }

      const lastMessage = result.messages[result.messages.length - 1];
      return {
        messages: [lastMessage as AIMessage],
      };
    },
  });
};
