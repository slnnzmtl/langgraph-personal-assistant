import { AIMessage, SystemMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../../mcp/supabase/index.js";
import { fetchWiseTransactions } from "./wise-client.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";

const UNTRUSTED_DATA_BLOCK_PATTERN = /(?:^|\n)<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-[^>]+>(?:\n|$)/m;

const tryParseJson = (input: string): unknown | undefined => {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
};

const extractJsonPayload = (input: string): string | undefined => {
  const untrustedBlock = input.match(UNTRUSTED_DATA_BLOCK_PATTERN)?.[1]?.trim();
  if (untrustedBlock) {
    return untrustedBlock;
  }

  const trimmed = input.trim();
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  return undefined;
};

const normalizeExecSqlOutput = (value: unknown, depth = 0): unknown => {
  if (depth > 4) {
    return value;
  }

  if (typeof value === "string") {
    const parsedDirectly = tryParseJson(value.trim());
    if (parsedDirectly !== undefined) {
      return normalizeExecSqlOutput(parsedDirectly, depth + 1);
    }

    const jsonPayload = extractJsonPayload(value);
    if (jsonPayload) {
      const parsedPayload = tryParseJson(jsonPayload);
      if (parsedPayload !== undefined) {
        return normalizeExecSqlOutput(parsedPayload, depth + 1);
      }
      return jsonPayload;
    }

    return value.trim();
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.result === "string") {
      return normalizeExecSqlOutput(record.result, depth + 1);
    }

    if (Array.isArray(record.rows)) {
      return record.rows;
    }

    return value;
  }

  return value;
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
        const normalizedResult = normalizeExecSqlOutput(result);

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
      const systemInstructions = new SystemMessage(loadFinanceSystemPrompt());
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("finance-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      return { messages: [response] };
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
