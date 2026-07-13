import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../../mcp/supabase/index.js";
import { fetchWiseTransactions } from "./tools/wise/index.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";
import { normalizeToolOutput } from "../../utils/exec-sql.js";

// An expense row must have an id, a name, and a paid_date (which category rows lack).
type ExpenseRecord = { id: string | number; name: string; paid_date: string; [key: string]: unknown };

const isExpenseRecord = (v: unknown): v is ExpenseRecord => {
  const r = v as Record<string, unknown>;
  return !!v
    && typeof v === "object"
    && (typeof r.id === "string" || typeof r.id === "number")
    && typeof r.name === "string"
    && typeof r.paid_date === "string";
};

const parseExpenseArray = (content: unknown): ExpenseRecord[] | undefined => {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isExpenseRecord)) {
      return parsed;
    }
  } catch {
    // not valid JSON — ignore
  }
  return undefined;
};

export const findLatestExpenseContinuation = (messages: BaseMessage[]): ExpenseRecord[] | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!(msg instanceof ToolMessage) || msg.name !== "exec_sql") continue;
    const rows = parseExpenseArray(msg.content);
    if (rows) return rows;
  }
  return undefined;
};

const getExpenseContinuation = (state: AgentState): ExpenseRecord[] | undefined =>
  findLatestExpenseContinuation(state.messages) ?? parseExpenseArray(state.context.financeExpenseSelection);

const buildFinanceSystemInstructions = (continuation: ExpenseRecord[] | undefined): string => {
  const base = loadFinanceSystemPrompt();
  if (!continuation) return base;
  return `${base}\n\n<latest_expense_selection>\n${JSON.stringify(continuation)}\n</latest_expense_selection>`;
};

/**
 * Create finance tools that the LLM can use.
 * These tools are executed by a ToolNode in the workflow graph.
 * 
 * @param session Direct SQL access to Supabase via official MCP
 * @returns Array of tools for finance operations
 */
export const createFinanceTools = (session: SupabaseMcpSession): StructuredToolInterface[] => {
  const execSql = tool(
    async (input: { sql: string }) => {
      try {
        const result = await session.executeSql(input.sql);
        const normalizedResult = normalizeToolOutput(result);

        if (typeof normalizedResult === "string") {
          return normalizedResult;
        }

        return JSON.stringify(normalizedResult);
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

  const fetchWise = tool(
    async (input: { since: string; until: string }) => {
      try {
        const transactions = await fetchWiseTransactions(input);
        const normalizedTransactions = normalizeToolOutput(transactions);
        return typeof normalizedTransactions === "string"
          ? normalizedTransactions
          : JSON.stringify(normalizedTransactions);
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

  return [execSql, fetchWise];
};

/**
 * Create a finance node that calls the LLM with finance tools.
 * Tool calls are generated here but executed by a separate ToolNode.
 * 
 * @param model The LLM to use for finance operations
 * @param tools The finance tools to bind to the model
 * @returns A node function compatible with LangGraph StateGraph
 */
export const createFinanceNode = (model: BaseChatModel, tools: StructuredToolInterface[]) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Finance LLM model must support tool calling.");
  }

  const modelWithTools = model.bindTools(tools);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      const continuation = getExpenseContinuation(state);
      const systemInstructions = new SystemMessage(buildFinanceSystemInstructions(continuation));
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("finance-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      return {
        messages: [response],
        ...(continuation ? { context: { financeExpenseSelection: continuation } } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      return {
        messages: [new AIMessage(`Unable to complete finance sync: ${errorMessage}`)],
      };
    }
  };
};

/**
 * Backward compatibility wrapper.
 * Creates both tools and node in one call.
 * 
 * @param session Direct SQL access to Supabase via official MCP
 * @param model The LLM to use for finance operations
 * @returns A node function compatible with LangGraph StateGraph
 */
export const createFinanceSubgraphNode = (session: SupabaseMcpSession, model: BaseChatModel) => {
  const tools = createFinanceTools(session);
  return createFinanceNode(model, tools);
};
