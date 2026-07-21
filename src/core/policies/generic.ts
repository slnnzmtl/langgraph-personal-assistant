import { resolveModel } from "../execution/context.js";
import {
  createSubAgentGraphBundle,
  mapDefaultSubAgentResult,
} from "../execution/create-sub-agent.js";
import { createRuntimeAgentNode, type RuntimeAgentNodeHooks } from "../execution/runtime-node.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import { createRuntimeAgentPolicy } from "../types/policy.js";
import type { SkillCatalog } from "../skills/catalog.js";

export type GenericPolicyDeps<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  resolveToolBundles: (
    bundleIds: RuntimeAgentDefinition["toolBundleIds"],
    bundleDeps: TBundleDeps,
  ) => import("@langchain/core/tools").StructuredToolInterface[];
  runtimeShellHooks?: RuntimeAgentNodeHooks;
  skillCatalog?: SkillCatalog;
  resolveAgentTools?: (
    definition: RuntimeAgentDefinition,
    bundleDeps: TBundleDeps,
    options?: { skillCatalog?: SkillCatalog },
  ) => import("@langchain/core/tools").StructuredToolInterface[];
};

export const createGenericPolicy = <
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
>(
  deps: GenericPolicyDeps<TBundleDeps>,
) =>
  createRuntimeAgentPolicy("generic", (context, definition) => {
    const bundleDeps = context.bundleDeps as TBundleDeps;

    return createSubAgentGraphBundle({
      name: definition.name,
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context),
        definition,
        bundleDeps,
        resolveToolBundles: deps.resolveToolBundles,
        resolveAgentTools: deps.resolveAgentTools,
        skillCatalog: deps.skillCatalog,
      },
      createTools: (agentDeps) => {
        if (agentDeps.resolveAgentTools) {
          return agentDeps.resolveAgentTools(agentDeps.definition, agentDeps.bundleDeps, {
            ...(agentDeps.skillCatalog ? { skillCatalog: agentDeps.skillCatalog } : {}),
          });
        }

        return agentDeps.resolveToolBundles(agentDeps.definition.toolBundleIds, agentDeps.bundleDeps);
      },
      createLlmNode: (agentDeps, tools) =>
        createRuntimeAgentNode(
          agentDeps.model,
          agentDeps.definition,
          tools,
          deps.runtimeShellHooks,
        ),
      mapResult: (result, config) => mapDefaultSubAgentResult(result, config),
    });
  });
