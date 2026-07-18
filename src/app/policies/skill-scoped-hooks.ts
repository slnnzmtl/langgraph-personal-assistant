import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { appendConfiguredSkillAttachments } from "../../runtime-agents/skill-attachments.js";

type SkillAttachmentNodeHookOverrides = Partial<RuntimeAgentNodeHooks> &
  Pick<RuntimeAgentNodeHooks, "logLabel" | "buildErrorMessage">;

export const createSkillAttachmentNodeHooks = (
  overrides: SkillAttachmentNodeHookOverrides,
): RuntimeAgentNodeHooks => ({
  buildSystemPrompt: (ctx) =>
    appendConfiguredSkillAttachments(ctx.basePrompt, ctx.definition, ctx.state.messages),
  ...overrides,
});
