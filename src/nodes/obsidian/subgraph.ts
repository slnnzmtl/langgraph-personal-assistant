import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AgentState, AgentStateUpdate } from "../../state.js";
import { reduceAgentMessages } from "../../state.js";
import type { IFileSender } from "../../telegram/file-sender.js";
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

const lastMessageHasToolCalls = (state: ObsidianSubgraphState): boolean => {
  const lastMessage = state.messages[state.messages.length - 1];
  return lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0;
};

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
      if (!lastMessageHasToolCalls(state)) return END;
      if (state.obsidianStepCount >= OBSIDIAN_MAX_STEPS) return END;
      return "tools";
    })
    .addEdge("tools", "incrementCounter")
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

  return async (parentState: AgentState): Promise<AgentStateUpdate> => {
    try {
      const obsidianStateInput: ObsidianSubgraphState = {
        messages: parentState.messages,
        obsidianStepCount: 0,
      };

      const result = await compiledSubgraph.invoke(obsidianStateInput);

      if (result.obsidianStepCount >= OBSIDIAN_MAX_STEPS) {
        return {
          messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${OBSIDIAN_MAX_STEPS} Obsidian tool steps.`)],
        };
      }

      const lastMessage = result.messages[result.messages.length - 1];
      return {
        messages: [lastMessage as AIMessage],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [new AIMessage(`Obsidian sub-graph failed: ${message}`)],
      };
    }
  };
};
