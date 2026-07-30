import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SqlSession } from "../../src/ports/sql-session.js";
import { fetchWiseTransactions } from "../../src/integrations/wise.js";
import { createFinanceDomainToolsFromSession } from "../../src/runtime-agents/finance/tools.js";
import { createReadSkillTool } from "@personal-assistant/supervisor-framework";
import { createTestSkillCatalog } from "./test-skills-dir.js";

export const createFinanceTestTools = (
  sqlSession: SqlSession,
  skillModule: string,
): StructuredToolInterface[] => {
  const skillCatalog = createTestSkillCatalog([skillModule, "finance", "obsidian", "configuration"]);

  return [
    createReadSkillTool(skillModule, "xml", { skillCatalog }),
    ...createFinanceDomainToolsFromSession(sqlSession, { fetchWise: fetchWiseTransactions }),
  ];
};

export const getFinanceDomainTool = (
  sqlSession: SqlSession,
  toolName: "exec_sql" | "fetch_wise_transactions" | "get_categories",
): StructuredToolInterface | undefined =>
  createFinanceDomainToolsFromSession(sqlSession, { fetchWise: fetchWiseTransactions }).find(
    (tool) => tool.name === toolName,
  );
