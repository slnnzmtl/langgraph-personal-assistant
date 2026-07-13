import { AIMessage } from "@langchain/core/messages";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AgentState, AgentStateUpdate } from "../../state.js";
import { createObsidianNode, ObsidianStateAnnotation } from "./obsidian.js";
import { createObsidianTools } from "./obsidian-tools.js";

export const OBSIDIAN_MAX_STEPS = 8;

/**
 * Create a compiled Obsidian sub-graph with internal tool loop.
 * The sub-graph has its own StateGraph with private messages channel.
 */
export const createCompiledObsidianSubgraph = (llmConnector: { getModel(): BaseChatModel }, vaultRoot: string) => {
  const obsidianNode = createObsidianNode(llmConnector, vaultRoot);
  const obsidianToolsNode = new ToolNode(createObsidianTools(vaultRoot));

  const graph = new StateGraph(ObsidianStateAnnotation)
    .addNode("llm", obsidianNode)
    .addNode("tools", obsidianToolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state) => {
      const lastMessage = state.messages[state.messages.length - 1];

      // Check for tool calls
      if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
      }

      // Legacy fallback guard for Gemini function call format
      if (lastMessage && typeof lastMessage === "object" && "additional_kwargs" in lastMessage) {
        if ((lastMessage as any).additional_kwargs?.functionCall) return "tools";
      }

      return END;
    })
    .addEdge("tools", "llm");

  const memory = new MemorySaver();
  return graph.compile({ checkpointer: memory, name: "obsidian-subgraph" });
};

/**
 * Wrap the compiled Obsidian sub-graph as a node for the parent StateGraph.
 * Transforms parent AgentState → ObsidianState, invokes the sub-graph,
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
      const obsidianStateInput = {
        messages: parentState.messages,
      };

      // Invoke the compiled sub-graph
      const result = await compiledSubgraph.invoke(obsidianStateInput);

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
