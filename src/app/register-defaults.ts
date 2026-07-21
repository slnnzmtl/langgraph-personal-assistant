import { createPolicyRegistry } from "../core/policies/registry.js";
import { createAgentPolicy } from "../core/policies/create-agent-policy.js";
import {
  appendDynamicSections,
  formatSystemMetadata,
  loadSystemPromptByKey,
} from "../prompts/load-system-prompt.js";
import { appendConfiguredSkillAttachments } from "../runtime-agents/skill-attachments.js";
import type { RuntimeToolBundleDeps } from "../runtime-agents/tool-bundles.js";
import {
  createConfigurationPolicy,
  createObsidianPolicy,
} from "./policies/index.js";
import type { RuntimeAgentPolicy } from "../core/types/policy.js";
import type { SkillCatalog } from "../core/skills/catalog.js";
import type { RuntimeShellFormatters } from "../core/system-context.js";
import { resolveAgentCapabilityTools } from "./composition/resolve-agent-tools.js";
import { createRuntimeShellHooks } from "../core/execution/runtime-shell.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => ({
  formatSystemMetadata,
  appendDynamicSections,
  appendSkillAttachments: (basePrompt, definition, messages) =>
    appendConfiguredSkillAttachments(basePrompt, definition, messages, skillCatalog),
});

export const DOMAIN_POLICY_FACTORIES: Record<string, (options: AppExecutionKitOptions) => RuntimeAgentPolicy> = {
  obsidian: createObsidianPolicy,
  configuration: createConfigurationPolicy,
};

export const DEPLOYMENT_EXECUTOR_IDS = Object.keys(DOMAIN_POLICY_FACTORIES);

export type AppExecutionKitOptions = {
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

export const createAppExecutionKit = (
  executors: Iterable<string> = DEPLOYMENT_EXECUTOR_IDS,
  options: AppExecutionKitOptions = {},
) => {
  const executorSet = new Set(executors);
  const shellFormatters = createDefaultRuntimeShellFormatters(options.skillCatalog);
  const genericShellHooks = createRuntimeShellHooks(shellFormatters);

  const domainPolicies = Object.entries(DOMAIN_POLICY_FACTORIES)
    .filter(([executor]) => executorSet.has(executor))
    .map(([, factory]) => factory({
      ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
      shellFormatters,
    }));

  const policyRegistry = createPolicyRegistry([
    createAgentPolicy({
      executor: "generic",
      resolveTools: (definition, bundleDeps, resolveOptions) =>
        resolveAgentCapabilityTools(definition, bundleDeps as RuntimeToolBundleDeps, resolveOptions ?? {}),
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
