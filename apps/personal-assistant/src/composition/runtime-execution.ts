import {
  createRuntimeShellHooks,
  type CapabilityCatalog,
  type RuntimeExecutionKit,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  appendDynamicSections,
  formatSystemMetadata,
  loadSystemPromptByKey,
} from "../load-system-prompt.js";
import { enrichRuntimeAgentPrompt } from "../runtime-agents/skills/prompt-enrichment.js";
import { createPersonalResolveTools } from "./personal-resolve-tools.js";
import { createDefaultRuntimeAgentPolicy } from "../policies/runtime-agent-policy.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => ({
  formatSystemMetadata,
  appendDynamicSections,
  appendSkillAttachments: (basePrompt, definition, messages) =>
    enrichRuntimeAgentPrompt(basePrompt, definition, messages, skillCatalog),
});

export type AppRuntimeExecutionOptions = {
  capabilityCatalog: CapabilityCatalog;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

/** Builds the personal pack default runtime execution kit (one generic policy + shell formatters). */
export const buildAppRuntimeExecution = (options: AppRuntimeExecutionOptions): RuntimeExecutionKit => {
  const shellFormatters = options.shellFormatters ?? createDefaultRuntimeShellFormatters(options.skillCatalog);
  const genericShellHooks = createRuntimeShellHooks(shellFormatters);
  const resolveTools = createPersonalResolveTools(options.capabilityCatalog);

  const policyOptions = {
    capabilityCatalog: options.capabilityCatalog,
    resolveTools,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
    shellFormatters,
  };

  return {
    loadPromptByKey: loadSystemPromptByKey,
    runtimeAgentPolicy: createDefaultRuntimeAgentPolicy(genericShellHooks, policyOptions),
    shellFormatters,
  };
};
