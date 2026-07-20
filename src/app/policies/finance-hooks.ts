import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { createSkillAttachmentNodeHooks } from "./skill-scoped-hooks.js";

export const createFinanceNodeHooks = (): RuntimeAgentNodeHooks =>
  createSkillAttachmentNodeHooks({
    logLabel: "finance-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to complete finance request: ${error instanceof Error ? error.message : "Unknown error during finance request"}`,
  });
