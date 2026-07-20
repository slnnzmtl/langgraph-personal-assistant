import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import {
  appendDynamicSections,
  formatSystemMetadata,
} from "../../prompts/load-system-prompt.js";
import { appendConfiguredSkillAttachments } from "../../runtime-agents/skill-attachments.js";

type SkillAttachmentNodeHookOverrides = Partial<RuntimeAgentNodeHooks> &
  Pick<RuntimeAgentNodeHooks, "logLabel" | "buildErrorMessage">;

export const createSkillAttachmentNodeHooks = (
  overrides: SkillAttachmentNodeHookOverrides,
): RuntimeAgentNodeHooks => ({
  buildSystemPrompt: (ctx) => {
    const withAttachments = appendConfiguredSkillAttachments(
      ctx.basePrompt.trim(),
      ctx.definition,
      ctx.state.messages,
    );

    return appendDynamicSections(
      withAttachments,
      formatSystemMetadata(new Date(), { runtimeAgent: ctx.definition.name }),
    );
  },
  ...overrides,
});
