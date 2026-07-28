import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { truncateToolOutput } from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../../integrations/mcp/supabase.js";
import { normalizeToolOutput } from "../../utils/exec-sql.js";
import { serializeToolResult } from "../shared/output.js";
import { fetchWiseTransactions } from "../../integrations/wise.js";

const CATEGORY_QUERY = "SELECT id, name, note FROM public.category;";

const GetCategoriesSchema = z.object({});

export type FinanceToolsOptions = {
  writeAccess?: boolean;
};

export const createFinanceDomainToolsFromSession = (
  mcpSession: SupabaseMcpSession,
  options: FinanceToolsOptions = {},
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

  const getCategories = tool(
    async (_input: z.infer<typeof GetCategoriesSchema>) => {
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
      schema: GetCategoriesSchema,
    },
  );

  const readTools = [execSql, getCategories];

  if (options.writeAccess === false) {
    return readTools;
  }

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

  return [...readTools, fetchWise];
};
