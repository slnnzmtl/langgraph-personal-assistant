import type { CapabilityCatalog } from "../capabilities/index.js";
import type { LoadPromptByKey } from "../core/agents/resolve-system-prompt.js";
import { createAgentPolicy } from "../core/policies/create-agent-policy.js";

import { resolveAgentTools } from "./resolve-agent-tools.js";
import type { RuntimeExecutionKit } from "./types.js";

export type BuildDefaultRuntimeExecutionOptions = {
  loadPromptByKey?: LoadPromptByKey;
  includeReadSkill?: boolean;
  reservedCapabilitiesByAgentId?: Record<string, readonly string[]>;
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
        ...(options.reservedCapabilitiesByAgentId
          ? { reservedCapabilitiesByAgentId: options.reservedCapabilitiesByAgentId }
          : {}),
      }),
  }),
});
