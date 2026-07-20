import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";

type SkillAttachmentNodeHookOverrides = Partial<RuntimeAgentNodeHooks> &
  Pick<RuntimeAgentNodeHooks, "logLabel" | "buildErrorMessage">;

export const createSkillAttachmentNodeHooks = (
  formatters: RuntimeShellFormatters,
  overrides: SkillAttachmentNodeHookOverrides,
): RuntimeAgentNodeHooks =>
  createRuntimeShellHooks(formatters, overrides);
