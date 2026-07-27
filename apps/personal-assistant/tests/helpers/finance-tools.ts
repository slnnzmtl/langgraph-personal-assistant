import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import { createFinanceDomainToolsFromSession } from "../../src/runtime-agents/tools/finance.js";
import { createReadSkillTool } from "../../src/runtime-agents/skills/skill-management.js";

export const createFinanceTestTools = (
  mcpSession: SupabaseMcpSession,
  skillModule: string,
): StructuredToolInterface[] => [
  createReadSkillTool(skillModule, "xml"),
  ...createFinanceDomainToolsFromSession(mcpSession),
];

export const getFinanceDomainTool = (
  mcpSession: SupabaseMcpSession,
  toolName: "exec_sql" | "fetch_wise_transactions" | "get_categories",
): StructuredToolInterface | undefined =>
  createFinanceDomainToolsFromSession(mcpSession).find((tool) => tool.name === toolName);
