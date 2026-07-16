import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { recoverEmptySyncExpensesResponse } from "../../runtime-agents/policies/finance/sync-continuation.js";
import { createSkillAttachmentNodeHooks } from "./skill-scoped-hooks.js";

export const createFinanceNodeHooks = (): RuntimeAgentNodeHooks =>
  createSkillAttachmentNodeHooks({
    logLabel: "finance-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to complete finance sync: ${error instanceof Error ? error.message : "Unknown error during finance sync"}`,
    emptyResponseMessage: () =>
      "Unable to continue the finance sync because the model returned an empty response. Please try again.",
    afterModelInvoke: async (ctx, { response }) =>
      recoverEmptySyncExpensesResponse(response, ctx.state.messages),
  });
