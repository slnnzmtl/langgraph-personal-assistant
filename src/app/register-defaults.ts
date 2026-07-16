import { createPolicyRegistry } from "../core/policies/registry.js";
import { createGenericPolicy } from "../core/policies/generic.js";
import { createPromptResolver } from "../core/agents/prompt-resolver.js";
import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import { resolveRuntimeToolBundles } from "../runtime-agents/tool-bundles.js";
import { createAppPolicies } from "./policies/index.js";

export const createAppExecutionKit = () => {
  const promptResolver = createPromptResolver(loadSystemPromptByKey);
  const policyRegistry = createPolicyRegistry([
    createGenericPolicy({
      resolveToolBundles: (bundleIds, bundleDeps) =>
        resolveRuntimeToolBundles(bundleIds, bundleDeps as Parameters<typeof resolveRuntimeToolBundles>[1]),
    }),
    ...createAppPolicies(),
  ]);

  return { promptResolver, policyRegistry };
};
