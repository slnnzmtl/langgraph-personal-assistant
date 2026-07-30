import type { StructuredToolInterface } from "@langchain/core/tools";

import type { ExecuteSql } from "../../src/runtime-agents/finance/tools.js";
import { createFetchWiseTransactions } from "../../src/integrations/wise.js";
import { createFinanceDomainTools } from "../../src/runtime-agents/finance/tools.js";
import { createReadSkillTool } from "@personal-assistant/supervisor-framework";
import { createTestSkillCatalog } from "./test-skills-dir.js";

const testFetchWise = createFetchWiseTransactions({
  wiseApiToken: "token",
  wiseProfileId: "profile",
})!;

export const createFinanceTestTools = (
  executeSql: ExecuteSql,
  skillModule: string,
): StructuredToolInterface[] => {
  const skillCatalog = createTestSkillCatalog([skillModule, "finance", "obsidian", "configuration"]);

  return [
    createReadSkillTool(skillModule, "xml", { skillCatalog }),
    ...createFinanceDomainTools(executeSql, { fetchWise: testFetchWise }),
  ];
};

export const getFinanceDomainTool = (
  executeSql: ExecuteSql,
  toolName: "exec_sql" | "fetch_wise_transactions" | "get_categories",
): StructuredToolInterface | undefined =>
  createFinanceDomainTools(executeSql, { fetchWise: testFetchWise }).find(
    (tool) => tool.name === toolName,
  );
