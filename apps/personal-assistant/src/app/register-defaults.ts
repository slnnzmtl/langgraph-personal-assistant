import {
  createRuntimeShellHooks,
  resolveAgentSkillModule,
  type CapabilityCatalog,
  type RuntimeAgentPolicy,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  appendDynamicSections,
  formatSystemMetadata,
  loadSystemPromptByKey,
} from "../agents/load-system-prompt.js";
import { appendConfiguredSkillAttachments } from "../runtime-agents/skill-attachments.js";
import {
  appendAvailableSkills,
  appendRuntimeExecutionModel,
} from "../runtime-agents/skills/prompt-enrichment.js";
import { createPersonalResolveTools } from "./composition/personal-resolve-tools.js";
import { createGenericRuntimeAgentPolicy } from "./policies/generic-runtime-policy.js";

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

/** Reserved for future built-in executors that cannot be expressed as generic + capabilities. */
export const DOMAIN_POLICY_FACTORIES: Record<
  string,
  (options: never) => RuntimeAgentPolicy
> = {};

export const DEPLOYMENT_EXECUTOR_IDS = Object.keys(DOMAIN_POLICY_FACTORIES);

export type AppExecutionKitOptions = {
  capabilityCatalog: CapabilityCatalog;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

export const createAppExecutionKit = (
  _executors: Iterable<string> = DEPLOYMENT_EXECUTOR_IDS,
  options: AppExecutionKitOptions,
) => {
  const shellFormatters = options.shellFormatters ?? createDefaultRuntimeShellFormatters(options.skillCatalog);
  const genericShellHooks = createRuntimeShellHooks(shellFormatters);
  const resolveTools = createPersonalResolveTools(options.capabilityCatalog);

  const policyOptions = {
    capabilityCatalog: options.capabilityCatalog,
    resolveTools,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
    shellFormatters,
  };

  const policies: RuntimeAgentPolicy[] = [
    createGenericRuntimeAgentPolicy(genericShellHooks, policyOptions),
  ];

  return { loadPromptByKey: loadSystemPromptByKey, policies, shellFormatters };
};
