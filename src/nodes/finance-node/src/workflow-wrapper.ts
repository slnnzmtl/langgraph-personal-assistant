import { AIMessage } from "@langchain/core/messages";
import type { AgentState } from "../../../state.js";
import type { FinanceRepository } from "./agent.js";
import { buildFinanceSyncGraph } from "./agent.js";

/**
 * Create a workflow node that bridges the finance sub-graph to the root agent state.
 * 
 * This wrapper:
 * - Accepts an AgentState from the root workflow
 * - Invokes the isolated finance sync graph with the provided repository
 * - Converts success/failure metrics into an AIMessage for the workflow history
 * - Returns an AgentStateUpdate with the message appended
 * 
 * @param repository The FinanceRepository for the sync pipeline to use
 * @returns A node function compatible with LangGraph StateGraph
 */
export function createFinanceSubgraphNode(repository: FinanceRepository) {
  return async (state: AgentState) => {
    const graph = buildFinanceSyncGraph(repository);
    
    try {
      const result = await graph.invoke({}, { configurable: { thread_id: "finance-sync-from-workflow" } });
      
      // Extract metrics from the successful sync result
      const { processed, skipped } = result.metrics;
      const message = new AIMessage(
        `Finance sync completed: ${processed} transactions processed, ${skipped} skipped.`,
      );
      
      return { messages: [message] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      const message = new AIMessage(`Finance sync failed: ${errorMessage}`);
      return { messages: [message] };
    }
  };
}
