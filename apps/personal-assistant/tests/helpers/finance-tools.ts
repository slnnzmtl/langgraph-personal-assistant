import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SqlSession } from "../../src/ports/sql-session.js";
import { createFetchWiseTransactions } from "../../src/integrations/wise.js";
import { createFinanceDomainToolsFromSession } from "../../src/runtime-agents/finance/tools.js";
import { createReadSkillTool } from "@personal-assistant/supervisor-framework";
import { createTestSkillCatalog } from "./test-skills-dir.js";

const testFetchWise = createFetchWiseTransactions({
  wiseApiToken: "token",
  wiseProfileId: "profile",
})!;

export const createFinanceTestTools = (
  sqlSession: SqlSession,
  skillModule: string,
): StructuredToolInterface[] => {
  const skillCatalog = createTestSkillCatalog([skillModule, "finance", "obsidian", "configuration"]);

  return [
    createReadSkillTool(skillModule, "xml", { skillCatalog }),
    ...createFinanceDomainToolsFromSession(sqlSession, { fetchWise: testFetchWise }),
  ];
};

export const getFinanceDomainTool = (
  sqlSession: SqlSession,
  toolName: "exec_sql" | "fetch_wise_transactions" | "get_categories",
): StructuredToolInterface | undefined =>
  createFinanceDomainToolsFromSession(sqlSession, { fetchWise: testFetchWise }).find(
    (tool) => tool.name === toolName,
  );
