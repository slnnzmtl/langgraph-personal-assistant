import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentState } from "../../../state.js";
import { extractMessageTextContent } from "../../message-history.js";
import type { FinanceRepository } from "./agent.js";
import { buildFinanceSyncGraph } from "./agent.js";

/**
 * Create a workflow node that bridges the finance sub-graph to the root agent state.
 * 
 * This wrapper:
 * - Accepts an AgentState from the root workflow
 * - Invokes the isolated finance sync graph with the provided repository
 * - Uses the LLM to generate a natural language summary of the sync result
 * - Returns an AgentStateUpdate with the message appended
 * 
 * @param repository The FinanceRepository for the sync pipeline to use
 * @param model The LLM model to generate natural language responses
 * @returns A node function compatible with LangGraph StateGraph
 */

/**
 * Build a system prompt that instructs the LLM how to summarize finance sync results.
 */
function buildFinanceSyncSystemPrompt(): SystemMessage {
  return new SystemMessage(
    `You are a financial assistant helping to communicate the status of automated finance synchronization tasks.
Your role is to summarize the results of a Wise transaction sync operation with Supabase in natural, conversational language.

Guidelines:
- Be concise but informative
- Mention the date range of synced transactions (from cursor date to sync date)
- Acknowledge successful transactions processed and duplicates skipped
- For errors, classify and explain whether it's a temporary network issue, data validation problem, or database issue
- Be helpful and friendly in tone

When reporting errors:
- "network" errors are transient connectivity issues (suggest retry)
- "validation" errors are data mismatches (suggest human review)
- "database" errors are storage layer issues (suggest investigation)`
  );
}

/**
 * Build a user message with the sync result context for the LLM.
 */
function buildFinanceSyncUserMessage(
  result: {
    cursorDate: string | undefined;
    syncUntil: string | undefined;
    metrics: { processed: number; skipped: number };
    error?: { type: "network" | "validation" | "database"; message: string } | undefined;
  }
): HumanMessage {
  if (result.error) {
    const { type, message } = result.error;
    return new HumanMessage(
      `Finance sync encountered an error:
- Error Type: ${type}
- Error Message: ${message}
- Cursor Date: ${result.cursorDate || "unknown"}
- Sync Timestamp: ${result.syncUntil || new Date().toISOString()}

Please summarize this sync attempt and what it means for the user.`
    );
  }

  return new HumanMessage(
    `Finance sync completed:
- Cursor Date (last sync boundary): ${result.cursorDate || "unknown"}
- Sync Timestamp: ${result.syncUntil || new Date().toISOString()}
- Transactions Processed: ${result.metrics.processed}
- Duplicates Skipped: ${result.metrics.skipped}

Please summarize this sync result for the user.`
  );
}

export function createFinanceSubgraphNode(repository: FinanceRepository, model: BaseChatModel) {
  return async (state: AgentState) => {
    const graph = buildFinanceSyncGraph(repository);

    try {
      const result = await graph.invoke({}, { configurable: { thread_id: "finance-sync-from-workflow" } });

      // Generate LLM response based on sync result
      const systemPrompt = buildFinanceSyncSystemPrompt();
      const userMessageInput: {
        cursorDate: string | undefined;
        syncUntil: string | undefined;
        metrics: { processed: number; skipped: number };
        error?: { type: "network" | "validation" | "database"; message: string };
      } = {
        cursorDate: result.cursorDate,
        syncUntil: result.syncUntil,
        metrics: result.metrics,
      };
      if (result.error) {
        userMessageInput.error = result.error;
      }
      const userMessage = buildFinanceSyncUserMessage(userMessageInput);

      const response = await model.invoke([systemPrompt, userMessage]);
      const responseText = extractMessageTextContent(response.content).trim();
      const message = new AIMessage(responseText || "Finance sync completed.");

      return { messages: [message] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";

      // Even on exception, try to generate a natural language error message
      const systemPrompt = buildFinanceSyncSystemPrompt();
      const errorUserMessage = new HumanMessage(
        `An unexpected error occurred during finance sync:
- Error: ${errorMessage}

Please acknowledge this error and suggest next steps.`
      );

      try {
        const errorResponse = await model.invoke([systemPrompt, errorUserMessage]);
        const errorResponseText = extractMessageTextContent(errorResponse.content).trim();
        return { messages: [new AIMessage(errorResponseText || `Finance sync failed: ${errorMessage}`)] };
      } catch {
        // Fallback if LLM error handling also fails
        return { messages: [new AIMessage(`Finance sync failed: ${errorMessage}`)] };
      }
    }
  };
}
