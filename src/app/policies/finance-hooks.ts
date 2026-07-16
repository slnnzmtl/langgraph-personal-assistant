import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { resolveTurnTools } from "../../core/execution/create-sub-agent.js";
import { appendConfiguredSkillAttachments } from "../../runtime-agents/skill-attachments.js";

export const createFinanceNodeHooks = (): RuntimeAgentNodeHooks => ({
  logLabel: "finance-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to complete finance sync: ${error instanceof Error ? error.message : "Unknown error during finance sync"}`,
  buildSystemPrompt: (ctx) =>
    appendConfiguredSkillAttachments(ctx.basePrompt, ctx.definition, ctx.state.messages),
  resolveToolsForTurn: (ctx) => {
    if (!ctx.tools) {
      return [];
    }

    return resolveTurnTools(ctx.tools, ctx.state.messages);
  },
});
