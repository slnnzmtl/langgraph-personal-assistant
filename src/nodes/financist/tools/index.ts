import { StructuredToolInterface, tool } from "@langchain/core/tools";
import { SupabaseMcpSession } from "../../../mcp/supabase/index.js";
import { normalizeToolOutput } from "../../../utils/exec-sql.js";
import { fetchWiseTransactions } from "./wise/index.js";
import { z } from "zod";

const TOOL_OUTPUT_MAX_CHARS = 8_000;
const truncateOutput = (output: string): string =>
  output.length <= TOOL_OUTPUT_MAX_CHARS
    ? output
    : `${output.slice(0, TOOL_OUTPUT_MAX_CHARS)}\u2026[truncated, ${output.length - TOOL_OUTPUT_MAX_CHARS} chars omitted]`;

export const createFinanceTools = (mcpSession: SupabaseMcpSession): StructuredToolInterface[] => {
  const execSql = tool(
    async (input: { sql: string }) => {
      try {
        const result = await mcpSession.executeSql(input.sql);
        const normalizedResult = normalizeToolOutput(result);

        if (typeof normalizedResult === "string") {
          return truncateOutput(normalizedResult);
        }

        return truncateOutput(JSON.stringify(normalizedResult));
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
        return truncateOutput(
          typeof normalizedTransactions === "string"
            ? normalizedTransactions
            : JSON.stringify(normalizedTransactions),
        );
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

  const getCategories = tool(
    async () => {
      try {
        const result = await mcpSession.executeSql("SELECT id, name, note FROM public.category;");
        const normalizedResult = normalizeToolOutput(result);

        if (typeof normalizedResult === "string") {
          return truncateOutput(normalizedResult);
        }

        return truncateOutput(JSON.stringify(normalizedResult));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "get_categories",
      description: "Fetch all expense categories from the database. Always call this before syncing or classifying expenses.",
      schema: z.object({}),
    }
  );

  return [execSql, fetchWise, getCategories];
};