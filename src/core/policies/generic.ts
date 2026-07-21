import type { StructuredToolInterface } from "@langchain/core/tools";

import { resolveModel } from "../execution/context.js";
import {
  createSubAgentGraphBundle,
  mapDefaultSubAgentResult,
} from "../execution/create-sub-agent.js";
import { createRuntimeAgentNode, type RuntimeAgentNodeHooks } from "../execution/runtime-node.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import { resolveAgentModelKey } from "../types/agent.js";
import { createRuntimeAgentPolicy } from "../types/policy.js";
import type { SkillCatalog } from "../skills/catalog.js";

export type GenericPolicyDeps<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  resolveAgentTools: (
    definition: RuntimeAgentDefinition,
    bundleDeps: TBundleDeps,
    options?: { skillCatalog?: SkillCatalog },
  ) => StructuredToolInterface[];
  runtimeShellHooks?: RuntimeAgentNodeHooks;
  skillCatalog?: SkillCatalog;
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
        model: resolveModel(context, resolveAgentModelKey(definition)),
        definition,
        bundleDeps,
        resolveAgentTools: deps.resolveAgentTools,
        skillCatalog: deps.skillCatalog,
      },
      createTools: (agentDeps) =>
        agentDeps.resolveAgentTools(agentDeps.definition, agentDeps.bundleDeps, {
          ...(agentDeps.skillCatalog ? { skillCatalog: agentDeps.skillCatalog } : {}),
        }),
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
