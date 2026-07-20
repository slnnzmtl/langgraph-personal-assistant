import { resolveModel } from "../execution/context.js";
import {
  createSubAgent,
  mapDefaultSubAgentResult,
} from "../execution/create-sub-agent.js";
import { createRuntimeAgentNode } from "../execution/runtime-node.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { RuntimeAgentPolicy } from "../types/policy.js";

export type GenericPolicyDeps<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  resolveToolBundles: (
    bundleIds: RuntimeAgentDefinition["toolBundleIds"],
    bundleDeps: TBundleDeps,
  ) => import("@langchain/core/tools").StructuredToolInterface[];
};

export const createGenericPolicy = <
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
>(
  deps: GenericPolicyDeps<TBundleDeps>,
): RuntimeAgentPolicy => ({
  executor: "generic",
  createHandler: (context, definition) => {
    const bundleDeps = context.bundleDeps as TBundleDeps;

    return createSubAgent({
      name: definition.name,
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context),
        definition,
        bundleDeps,
        resolveToolBundles: deps.resolveToolBundles,
      },
      createTools: (agentDeps) =>
        agentDeps.resolveToolBundles(agentDeps.definition.toolBundleIds, agentDeps.bundleDeps),
      createLlmNode: (agentDeps, tools) =>
        createRuntimeAgentNode(agentDeps.model, agentDeps.definition, tools),
      mapResult: (result, config) => mapDefaultSubAgentResult(result, config),
    });
  },
});
