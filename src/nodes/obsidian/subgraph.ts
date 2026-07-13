import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Annotation } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AgentState, AgentStateUpdate } from "../../state.js";
import { reduceAgentMessages } from "../../state.js";
import { createObsidianNode, ObsidianStateAnnotation as BaseObsidianStateAnnotation } from "./index.js";
import { createObsidianTools } from "./tools.js";

export const OBSIDIAN_MAX_STEPS = 8;

/**
 * Extended Obsidian state with step tracking for loop enforcement.
 * Tracks tool execution steps to prevent infinite loops.
 */
export const ObsidianSubgraphStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  obsidianStepCount: Annotation<number>({
    reducer: (current: number, _update: number) => current,
    default: () => 0,
  }),
});

export type ObsidianSubgraphState = typeof ObsidianSubgraphStateAnnotation.State;

/**
 * Create a compiled Obsidian sub-graph with internal tool loop.
 * The sub-graph has its own StateGraph with step tracking to enforce max-step limits.
 */
export const createCompiledObsidianSubgraph = (llmConnector: { getModel(): BaseChatModel }, vaultRoot: string) => {
  // Create tools once and reuse across node and ToolNode
  const tools = createObsidianTools(vaultRoot);
  
  const obsidianNode = createObsidianNode(llmConnector, vaultRoot, tools);
  const obsidianToolsNode = new ToolNode(tools);

  // Step counter node: increments after tool execution
  const incrementStepCounter = async (state: ObsidianSubgraphState) => {
    return { obsidianStepCount: state.obsidianStepCount + 1 };
  };

  const graph = new StateGraph(ObsidianSubgraphStateAnnotation)
    .addNode("llm", obsidianNode)
    .addNode("tools", obsidianToolsNode)
    .addNode("incrementCounter", incrementStepCounter)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: ObsidianSubgraphState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const hasToolCalls = 
        (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) ||
        (lastMessage && typeof lastMessage === "object" && "additional_kwargs" in lastMessage && (lastMessage as any).additional_kwargs?.functionCall);

      if (!hasToolCalls) {
        return END;
      }

      // Enforce max-step limit
      if (state.obsidianStepCount >= OBSIDIAN_MAX_STEPS) {
        return END;
      }

      return "tools";
    })
    .addEdge("tools", "incrementCounter")
    .addEdge("incrementCounter", "llm");

  const memory = new MemorySaver();
  return graph.compile({ checkpointer: memory, name: "obsidian-subgraph" });
};

/**
 * Wrap the compiled Obsidian sub-graph as a node for the parent StateGraph.
 * Transforms parent AgentState → ObsidianSubgraphState, invokes the sub-graph,
 * and returns only the final AI message back to the parent.
 *
 * @param llmConnector LLM connector with getModel() method
 * @param vaultRoot Root directory of the Obsidian vault
 * @returns A node function that takes AgentState and returns AgentStateUpdate
 */
export const createObsidianSubgraphWrapper = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
) => {
  const compiledSubgraph = createCompiledObsidianSubgraph(llmConnector, vaultRoot);

  return async (parentState: AgentState): Promise<AgentStateUpdate> => {
    try {
      // Transform: parent state → obsidian sub-graph state
      const obsidianStateInput: ObsidianSubgraphState = {
        messages: parentState.messages,
        obsidianStepCount: 0,
      };

      // Invoke the compiled sub-graph
      const result = await compiledSubgraph.invoke(obsidianStateInput);

      // Check if we hit the max-step limit
      if (result.obsidianStepCount >= OBSIDIAN_MAX_STEPS) {
        return {
          messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${OBSIDIAN_MAX_STEPS} Obsidian tool steps.`)],
        };
      }

      // Extract the final AI message from the sub-graph
      const lastMessage = result.messages[result.messages.length - 1];
      const finalAIMessage = lastMessage instanceof AIMessage ? lastMessage : new AIMessage("Obsidian task completed.");

      // Return: only the final AI message to parent
      return {
        messages: [finalAIMessage],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [new AIMessage(`Obsidian sub-graph failed: ${message}`)],
      };
    }
  };
};
