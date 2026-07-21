import type { StructuredToolInterface } from "@langchain/core/tools";

import { createAgentPolicy } from "./create-agent-policy.js";
import type { RuntimeAgentNodeHooks } from "../execution/runtime-node.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
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
  createAgentPolicy({
    executor: "generic",
    resolveTools: (definition, bundleDeps, options) =>
      deps.resolveAgentTools(
        definition,
        bundleDeps as TBundleDeps,
        options,
      ),
    ...(deps.runtimeShellHooks ? { hooks: deps.runtimeShellHooks } : {}),
  });
