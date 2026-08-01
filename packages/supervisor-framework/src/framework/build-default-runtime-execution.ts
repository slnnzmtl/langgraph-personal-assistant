import type { CapabilityCatalog } from "../capabilities/catalog.js";
import type { LoadPromptByKey } from "../core/agents/resolve-system-prompt.js";
import { createAgentPolicy } from "../core/policies/create-agent-policy.js";

import { resolveAgentTools } from "./resolve-agent-tools.js";
import type { RuntimeExecutionKit } from "./types.js";

export type BuildDefaultRuntimeExecutionOptions = {
  loadPromptByKey?: LoadPromptByKey;
  includeReadSkill?: boolean;
};

export const buildDefaultRuntimeExecution = (
  catalog: CapabilityCatalog,
  options: BuildDefaultRuntimeExecutionOptions = {},
): RuntimeExecutionKit => ({
  loadPromptByKey: options.loadPromptByKey ?? (() => ""),
  runtimeAgentPolicy: createAgentPolicy({
    resolveTools: (definition, deps) =>
      resolveAgentTools(definition, catalog, deps, {
        includeReadSkill: options.includeReadSkill ?? false,
      }),
  }),
});
