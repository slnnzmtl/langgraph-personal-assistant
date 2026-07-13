import { AIMessage } from "@langchain/core/messages";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SupabaseMcpSession } from "../../mcp/supabase/index.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { createFinanceNode, FinanceStateAnnotation } from "./index.js";
import { createFinanceTools } from "./tools/index.js";

export const FINANCE_MAX_STEPS = 10;

/**
 * Create a compiled Finance sub-graph with internal tool loop.
 * The sub-graph has its own StateGraph with private financeStepCount and financeExpenseSelection.
 */
export const createCompiledFinanceSubgraph = (model: BaseChatModel, tools: ReturnType<typeof createFinanceTools>) => {
  const financeNode = createFinanceNode(model, tools);
  const financeToolsNode = new ToolNode(tools);

  const graph = new StateGraph(FinanceStateAnnotation)
    .addNode("llm", financeNode)
    .addNode("tools", financeToolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (
        lastMessage instanceof AIMessage &&
        lastMessage.tool_calls &&
        lastMessage.tool_calls.length > 0 &&
        state.financeStepCount < FINANCE_MAX_STEPS
      ) {
        return "tools";
      }
      return END;
    })
    .addEdge("tools", "llm");

  const memory = new MemorySaver();
  return graph.compile({ checkpointer: memory, name: "finance-subgraph" });
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
      // Transform: parent state → finance sub-graph state
      const financeStateInput = {
        messages: parentState.messages,
        financeStepCount: 0,
        financeExpenseSelection: (parentState.context.financeExpenseSelection as any[] | undefined) ?? [],
      };

      // Invoke the compiled sub-graph
      const result = await compiledSubgraph.invoke(financeStateInput);

      // Extract the final AI message from the sub-graph
      const lastMessage = result.messages[result.messages.length - 1];
      const finalAIMessage = lastMessage instanceof AIMessage ? lastMessage : new AIMessage("Finance sync completed.");

      // Return: only the final AI message to parent; preserve financeExpenseSelection in context for cross-turn survival
      return {
        messages: [finalAIMessage],
        context: {
          financeExpenseSelection: result.financeExpenseSelection,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        messages: [new AIMessage(`Finance sub-graph failed: ${message}`)],
      };
    }
  };
};
