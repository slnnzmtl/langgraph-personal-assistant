import type { CapabilityCatalog } from "./catalog.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { isRuntimeAgentBuiltin, resolveAgentCapabilityIds } from "../core/types/agent.js";

export const validatePersistedAgentCapabilities = (
  agents: RuntimeAgentDefinition[],
  catalog: CapabilityCatalog,
  deps: Record<string, unknown>,
): void => {
  for (const agent of agents) {
    if (isRuntimeAgentBuiltin(agent)) {
      continue;
    }

    const capabilityIds = resolveAgentCapabilityIds(agent);
    const reserved = new Set(catalog.reservedCapabilityIdsForAgent(agent.id));
    const toValidate = capabilityIds.filter((id) => !reserved.has(id));

    if (toValidate.length > 0) {
      catalog.validateGrantableIds(toValidate, deps);
    }
  }
};
