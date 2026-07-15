import { StructuredToolInterface, tool } from "@langchain/core/tools";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { normalizeToolOutput } from "../../utils/exec-sql.js";
import { getSkillsDir } from "../../prompts/load-system-prompt.js";
import { listSkills, readSkillContent } from "../../prompts/skills-loader.js";
import { z } from "zod";
import { fetchWiseTransactions } from "../../services/wise/index.js";

const serializeResult = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

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
        return truncateOutput(serializeResult(normalizedResult));
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
        return truncateOutput(serializeResult(normalizedTransactions));
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
        return truncateOutput(serializeResult(normalizedResult));
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

  const readSkill = tool(
    async (input: { name: string }) => {
      try {
        const skillsDir = getSkillsDir("finance");
        const content = readSkillContent(skillsDir, input.name);
        return truncateOutput(content);
      } catch (error) {
        const skillsDir = getSkillsDir("finance");
        const availableSkills = listSkills(skillsDir);
        const skillNames = availableSkills.map((s) => s.name).join(", ");
        const message = error instanceof Error ? error.message : String(error);
        return `Error reading skill: ${message}\nAvailable skills: ${skillNames || "none"}`;
      }
    },
    {
      name: "read_skill",
      description:
        "Load the full step-by-step instructions for a named skill before performing it. Pass the skill name exactly.",
      schema: z.object({
        name: z.string().describe("The name of the skill to read (e.g., 'sync-expenses')"),
      }),
    }
  );

  return [execSql, fetchWise, getCategories, readSkill];
};