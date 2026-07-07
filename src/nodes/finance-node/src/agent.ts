import { AIMessage, SystemMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SupabaseMcpSession } from "../../../packages/finance-server/src/index.js";
import { fetchWiseTransactions } from "./wise-client.js";
import { extractMessageTextContent } from "../../message-history.js";
import type { AgentState, AgentStateUpdate } from "../../../state.js";
import { loadFinanceSystemPrompt } from "../../../prompts/load-system-prompt.js";

/**
 * Create a finance sync node that uses the LLM to drive SQL queries directly.
 * 
 * The LLM receives two tools:
 * - exec_sql(sql) — Execute any SQL query against Supabase
 * - fetch_wise_transactions(since, until) — Fetch transactions from Wise API
 * 
 * The LLM decides what queries to run and what to do with the results.
 * 
 * @param session Direct SQL access to Supabase via official MCP
 * @param model The LLM to use for finance operations
 * @returns A node function compatible with LangGraph StateGraph
 */
export const createFinanceSubgraphNode = (session: SupabaseMcpSession, model: BaseChatModel) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Finance LLM model must support tool calling.");
  }

  // Define exec_sql tool — LLM can execute any SQL
  const execSql = tool(
    async (input: { sql: string }) => {
      try {
        const result = await session.executeSql(input.sql);
        return JSON.stringify(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "exec_sql",
      description: "Execute a SQL query against Supabase. Returns rows as JSON.",
      schema: z.object({
        sql: z.string().describe("The SQL query to execute"),
      }),
    }
  );

  // Define fetch_wise_transactions tool — LLM calls when it needs transaction data
  const fetchWise = tool(
    async (input: { since: string; until: string }) => {
      try {
        const transactions = await fetchWiseTransactions(input);
        return JSON.stringify(transactions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "fetch_wise_transactions",
      description: "Fetch transactions from the Wise API for a date range",
      schema: z.object({
        since: z.string().describe("Start date (ISO 8601)"),
        until: z.string().describe("End date (ISO 8601)"),
      }),
    }
  );

  // Bind tools to model
  const modelWithTools = model.bindTools([execSql, fetchWise]);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      // Load the finance system prompt
      const systemInstructions = new SystemMessage(loadFinanceSystemPrompt());

      // Merge system instructions with agent state messages
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      // Invoke the model with tools
      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      return {
        messages: [response],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      return {
        messages: [new AIMessage(`Unable to complete finance sync: ${errorMessage}`)],
      };
    }
  };
};
