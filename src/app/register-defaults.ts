import { createPolicyRegistry } from "../core/policies/registry.js";
import { createGenericPolicy } from "../core/policies/generic.js";
import { createPromptResolver } from "../core/agents/prompt-resolver.js";
import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import { BUILTIN_DOMAIN_IDS } from "../runtime-agents/builtin-domains.js";
import { resolveRuntimeToolBundles } from "../runtime-agents/tool-bundles.js";
import type { RuntimeToolBundleDeps } from "../runtime-agents/tool-bundles.js";
import {
  createConfigurationPolicy,
  createFinancePolicy,
  createObsidianPolicy,
} from "./policies/index.js";
import type { RuntimeAgentPolicy } from "../core/types/policy.js";

export const DOMAIN_POLICY_FACTORIES: Record<string, () => RuntimeAgentPolicy> = {
  finance: createFinancePolicy,
  obsidian: createObsidianPolicy,
  configuration: createConfigurationPolicy,
};

export const createAppExecutionKit = (
  executors: Iterable<string> = BUILTIN_DOMAIN_IDS,
) => {
  const promptResolver = createPromptResolver(loadSystemPromptByKey);
  const executorSet = new Set(executors);
  const domainPolicies = Object.entries(DOMAIN_POLICY_FACTORIES)
    .filter(([executor]) => executorSet.has(executor))
    .map(([, factory]) => factory());

  const policyRegistry = createPolicyRegistry([
    createGenericPolicy({
      resolveToolBundles: (bundleIds, bundleDeps: RuntimeToolBundleDeps) =>
        resolveRuntimeToolBundles(bundleIds, bundleDeps),
    }),
    ...domainPolicies,
  ]);

  return { promptResolver, policyRegistry };
};
