import type { CapabilityCatalog } from "./catalog.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { resolveAgentCapabilityIds } from "../core/types/agent.js";
import { isSystemAgentId } from "../framework/system-agent/definition.js";

export type ValidatePersistedAgentCapabilitiesOptions = {
  reservedCapabilitiesByAgentId?: Record<string, readonly string[]>;
};

export const validatePersistedAgentCapabilities = (
  agents: RuntimeAgentDefinition[],
  catalog: CapabilityCatalog,
  deps: Record<string, unknown>,
  options: ValidatePersistedAgentCapabilitiesOptions = {},
): void => {
  for (const agent of agents) {
    if (isSystemAgentId(agent.id)) {
      continue;
    }

    const capabilityIds = resolveAgentCapabilityIds(agent);
    const reserved = new Set(options.reservedCapabilitiesByAgentId?.[agent.id] ?? []);
    const toValidate = capabilityIds.filter((id) => !reserved.has(id));

    if (toValidate.length > 0) {
      catalog.validateGrantableIds(toValidate, deps);
    }
  }
};
