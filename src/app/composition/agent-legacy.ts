import { isRuntimeAgentBuiltin, type RuntimeAgentDefinition } from "../../core/types/agent.js";

/** Persisted executor values remapped to generic at load time. */
export const LEGACY_EXECUTORS_REMAP_TO_GENERIC = new Set(["finance"]);

/** Capability IDs that identify user-created local module agents in this deployment. */
export const DOMAIN_MODULE_CAPABILITY_IDS = new Set(["finance-domain", "obsidian-vault"]);

export const migrateLegacyExecutorAgent = (
  definition: RuntimeAgentDefinition,
): RuntimeAgentDefinition => {
  const legacyExecutor = definition.executor ?? "generic";

  if (!LEGACY_EXECUTORS_REMAP_TO_GENERIC.has(legacyExecutor)) {
    return definition;
  }

  const modelKey = definition.modelKey ?? legacyExecutor;

  return {
    ...definition,
    executor: "generic",
    modelKey,
  };
};

export const isLocalModuleAgent = (definition: RuntimeAgentDefinition): boolean =>
  !isRuntimeAgentBuiltin(definition)
  && definition.capabilityIds.some((capabilityId) => DOMAIN_MODULE_CAPABILITY_IDS.has(capabilityId));
