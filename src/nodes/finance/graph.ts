import { AIMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { hasPendingToolCalls, lastMessageRequestsTools } from "../../tools/routing.js";
import { createFinanceNode, FinanceStateAnnotation, createFinanceTools } from "./index.js";

export const FINANCE_MAX_STEPS = 10;

export const createCompiledFinanceSubgraph = (model: BaseChatModel, tools: ReturnType<typeof createFinanceTools>) => {
  const financeNode = createFinanceNode(model, tools);
  const financeToolsNode = new ToolNode(tools);

  const graph = new StateGraph(FinanceStateAnnotation)
    .addNode("llm", financeNode)
    .addNode("tools", financeToolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state) => {
      if (state.financeStepCount >= FINANCE_MAX_STEPS) {
        return END;
      }

      if (hasPendingToolCalls(state.messages) || lastMessageRequestsTools(state.messages)) {
        return "tools";
      }

      return END;
    })
    .addConditionalEdges("tools", (state) => {
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }

      return "llm";
    });

  return graph.compile({ name: "finance-subgraph" });
};

/**
 * Wrap the compiled Finance sub-graph as a node for the parent StateGraph.
 * Transforms parent AgentState → FinanceState, invokes the sub-graph, 
 * and returns only the final AI message back to the parent.
 * 
 * @param session Supabase MCP session for SQL execution
 * @param model The LLM to use for finance operations
 * @returns A node function that takes AgentState and returns AgentStateUpdate
 */
export const createFinanceSubgraphWrapper = (session: SupabaseMcpSession, model: BaseChatModel) => {
  const tools = createFinanceTools(session);
  const compiledSubgraph = createCompiledFinanceSubgraph(model, tools);

  return async (parentState: AgentState): Promise<AgentStateUpdate> => {
    try {
      const financeStateInput = {
        messages: parentState.messages,
        financeStepCount: 0,
      };

      const result = await compiledSubgraph.invoke(financeStateInput);

      const lastMessage = result.messages[result.messages.length - 1];

      return {
        messages: [lastMessage as AIMessage],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [new AIMessage(`Finance sub-graph failed: ${message}`)],
      };
    }
  };
};
