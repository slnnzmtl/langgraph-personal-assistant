import type { RuntimeAgentNodeHooks } from "./runtime-node.js";
import {
  defaultAppendDynamicSections,
  type RuntimeShellFormatters,
} from "../system-context.js";

export const createRuntimeShellHooks = (
  formatters: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  const appendSections = formatters.appendDynamicSections ?? defaultAppendDynamicSections;

  return {
    buildSystemPrompt: (ctx) => {
      const withAttachments = formatters.appendSkillAttachments
        ? formatters.appendSkillAttachments(
          ctx.basePrompt.trim(),
          ctx.definition,
          ctx.state.agentMessages,
        )
        : ctx.basePrompt.trim();

      return appendSections(
        withAttachments,
        formatters.formatSystemMetadata(new Date(), { runtimeAgent: ctx.definition.name }),
      );
    },
  };
};
