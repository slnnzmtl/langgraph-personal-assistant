import type { RuntimeAgentNodeHooks } from "./runtime-node.js";
import {
  defaultAppendDynamicSections,
  type RuntimeShellFormatters,
} from "../system-context.js";

type RuntimeShellOverrides = Partial<RuntimeAgentNodeHooks> &
  Pick<RuntimeAgentNodeHooks, "logLabel" | "buildErrorMessage">;

export const createRuntimeShellHooks = (
  formatters: RuntimeShellFormatters,
  overrides: RuntimeShellOverrides,
): RuntimeAgentNodeHooks => {
  const appendSections = formatters.appendDynamicSections ?? defaultAppendDynamicSections;

  return {
    buildSystemPrompt: (ctx) => {
      const withAttachments = formatters.appendSkillAttachments
        ? formatters.appendSkillAttachments(
          ctx.basePrompt.trim(),
          ctx.definition,
          ctx.state.messages,
        )
        : ctx.basePrompt.trim();

      return appendSections(
        withAttachments,
        formatters.formatSystemMetadata(new Date(), { runtimeAgent: ctx.definition.name }),
      );
    },
    ...overrides,
  };
};
