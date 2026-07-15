import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { normalizeToolOutput } from "../../utils/exec-sql.js";
import { serializeToolResult, truncateToolOutput } from "../../tools/output.js";
import { fetchWiseTransactions } from "../../services/wise/index.js";

const CATEGORY_QUERY = "SELECT id, name, note FROM public.category;";

export const createFinanceDomainToolsFromSession = (
  mcpSession: SupabaseMcpSession,
): StructuredToolInterface[] => {
  const execSql = tool(
    async (input: { sql: string }) => {
      try {
        const result = await mcpSession.executeSql(input.sql);
        const normalizedResult = normalizeToolOutput(result);
        return truncateToolOutput(serializeToolResult(normalizedResult));
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
    },
  );

  const fetchWise = tool(
    async (input: { since: string; until: string }) => {
      try {
        const transactions = await fetchWiseTransactions(input);
        const normalizedTransactions = normalizeToolOutput(transactions);
        return truncateToolOutput(serializeToolResult(normalizedTransactions));
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
    },
  );

  const getCategories = tool(
    async () => {
      try {
        const result = await mcpSession.executeSql(CATEGORY_QUERY);
        const normalizedResult = normalizeToolOutput(result);
        return truncateToolOutput(serializeToolResult(normalizedResult));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "get_categories",
      description: "Fetch all expense categories",
      schema: z.object({}),
    },
  );

  return [execSql, fetchWise, getCategories];
};
