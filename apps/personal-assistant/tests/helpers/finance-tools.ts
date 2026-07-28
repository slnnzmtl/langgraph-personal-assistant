import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SupabaseMcpSession } from "../../src/integrations/mcp/supabase.js";
import { createFinanceDomainToolsFromSession } from "../../src/runtime-agents/finance/tools.js";
import { createReadSkillTool } from "@personal-assistant/supervisor-framework";
import { createTestSkillCatalog } from "./test-skills-dir.js";

export const createFinanceTestTools = (
  mcpSession: SupabaseMcpSession,
  skillModule: string,
): StructuredToolInterface[] => {
  const skillCatalog = createTestSkillCatalog([skillModule, "finance", "obsidian", "configuration"]);

  return [
    createReadSkillTool(skillModule, "xml", { skillCatalog }),
    ...createFinanceDomainToolsFromSession(mcpSession),
  ];
};

export const getFinanceDomainTool = (
  mcpSession: SupabaseMcpSession,
  toolName: "exec_sql" | "fetch_wise_transactions" | "get_categories",
): StructuredToolInterface | undefined =>
  createFinanceDomainToolsFromSession(mcpSession).find((tool) => tool.name === toolName);
