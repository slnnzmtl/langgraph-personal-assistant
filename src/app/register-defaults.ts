import { createPolicyRegistry } from "../core/policies/registry.js";
import type { AppBundleDeps } from "./bundle-deps.js";
import { createGenericPolicy } from "../core/policies/generic.js";
import { createPromptResolver } from "../core/agents/prompt-resolver.js";
import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import { resolveRuntimeToolBundles } from "../runtime-agents/tool-bundles.js";
import {
  createConfigurationPolicy,
  createFinancePolicy,
  createObsidianPolicy,
} from "./policies/index.js";

const DOMAIN_POLICY_FACTORIES = {
  finance: createFinancePolicy,
  obsidian: createObsidianPolicy,
  configuration: createConfigurationPolicy,
} as const;

export const createAppExecutionKit = (executors: Iterable<string> = Object.keys(DOMAIN_POLICY_FACTORIES)) => {
  const promptResolver = createPromptResolver(loadSystemPromptByKey);
  const executorSet = new Set(executors);
  const domainPolicies = Object.entries(DOMAIN_POLICY_FACTORIES)
    .filter(([executor]) => executorSet.has(executor))
    .map(([, factory]) => factory());

  const policyRegistry = createPolicyRegistry([
    createGenericPolicy({
      resolveToolBundles: (bundleIds, bundleDeps: AppBundleDeps) =>
        resolveRuntimeToolBundles(bundleIds, bundleDeps),
    }),
    ...domainPolicies,
  ]);

  return { promptResolver, policyRegistry };
};
