import {
  createRuntimeShellHooks,
  resolveAgentSkillModule,
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
import { appendConfiguredSkillAttachments } from "../runtime-agents/skill-attachments.js";
import {
  appendAvailableSkills,
  appendRuntimeExecutionModel,
} from "../runtime-agents/skills/prompt-enrichment.js";
import { createPersonalResolveTools } from "./personal-resolve-tools.js";
import { createDefaultRuntimeAgentPolicy } from "../policies/runtime-agent-policy.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => {
  const skillModules = new Set(skillCatalog?.listModules() ?? []);

  return {
    formatSystemMetadata,
    appendDynamicSections,
    appendSkillAttachments: (basePrompt, definition, messages) => {
      const module = resolveAgentSkillModule(definition);
      let prompt = basePrompt.trim();

      if (skillCatalog) {
        prompt = appendAvailableSkills(prompt, module, skillCatalog);
      }

      prompt = appendConfiguredSkillAttachments(prompt, definition, messages, skillCatalog);

      if (skillCatalog && skillModules.has(module)) {
        prompt = appendRuntimeExecutionModel(prompt);
      }

      return prompt;
    },
  };
};

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
