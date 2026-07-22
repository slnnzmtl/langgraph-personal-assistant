import {
  createAgentPolicy,
  createPolicyRegistry,
  createRuntimeShellHooks,
  type CapabilityCatalog,
  type RuntimeAgentPolicy,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  appendDynamicSections,
  formatSystemMetadata,
  loadSystemPromptByKey,
} from "../prompts/load-system-prompt.js";
import { appendConfiguredSkillAttachments } from "../runtime-agents/skill-attachments.js";
import type { CapabilityDeps } from "../runtime-agents/builtin-capabilities.js";
import {
  createConfigurationPolicy,
  createObsidianPolicy,
  type DomainPolicyOptions,
} from "./policies/index.js";
import { createPersonalResolveTools } from "./composition/personal-resolve-tools.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => ({
  formatSystemMetadata,
  appendDynamicSections,
  appendSkillAttachments: (basePrompt, definition, messages) =>
    appendConfiguredSkillAttachments(basePrompt, definition, messages, skillCatalog),
});

export const DOMAIN_POLICY_FACTORIES: Record<
  string,
  (options: DomainPolicyOptions) => RuntimeAgentPolicy
> = {
  obsidian: createObsidianPolicy,
  configuration: createConfigurationPolicy,
};

export const DEPLOYMENT_EXECUTOR_IDS = Object.keys(DOMAIN_POLICY_FACTORIES);

export type AppExecutionKitOptions = {
  capabilityCatalog: CapabilityCatalog;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

export const createAppExecutionKit = (
  executors: Iterable<string> = DEPLOYMENT_EXECUTOR_IDS,
  options: AppExecutionKitOptions,
) => {
  const executorSet = new Set(executors);
  const shellFormatters = createDefaultRuntimeShellFormatters(options.skillCatalog);
  const genericShellHooks = createRuntimeShellHooks(shellFormatters);
  const resolveTools = createPersonalResolveTools(options.capabilityCatalog);

  const domainPolicyOptions = {
    capabilityCatalog: options.capabilityCatalog,
    resolveTools,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
    shellFormatters,
  };

  const domainPolicies = Object.entries(DOMAIN_POLICY_FACTORIES)
    .filter(([executor]) => executorSet.has(executor))
    .map(([, factory]) => factory(domainPolicyOptions));

  const policyRegistry = createPolicyRegistry([
    createAgentPolicy<CapabilityDeps>({
      executor: "generic",
      resolveTools: (definition, capabilityDeps, resolveOptions) =>
        resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
      hooks: genericShellHooks,
      logLabel: "generic-runtime-agent",
      buildErrorMessage: (error, definition) =>
        `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
    }, {
      ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
      shellFormatters,
    }),
    ...domainPolicies,
  ]);

  return { loadPromptByKey: loadSystemPromptByKey, policyRegistry, shellFormatters };
};
