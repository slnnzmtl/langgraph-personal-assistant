import type { StructuredToolInterface } from "@langchain/core/tools";

import type { CapabilityCatalog } from "../capabilities/index.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { resolveAgentCapabilityIds } from "../core/types/agent.js";
import { isSystemAgentId } from "./system-agent/definition.js";

const dedupeToolsByName = (tools: StructuredToolInterface[]): StructuredToolInterface[] => {
  const seen = new Set<string>();
  const result: StructuredToolInterface[] = [];

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }

    seen.add(tool.name);
    result.push(tool);
  }

  return result;
};

const filterGrantableCapabilityIds = (
  definition: RuntimeAgentDefinition,
  catalog: CapabilityCatalog,
  deps: Record<string, unknown>,
): readonly string[] => {
  const capabilityIds = resolveAgentCapabilityIds(definition);

  if (isSystemAgentId(definition.id)) {
    return capabilityIds;
  }

  const reserved = new Set(catalog.reservedCapabilityIdsForAgent(definition.id));
  const toValidate = capabilityIds.filter((id) => !reserved.has(id));

  if (toValidate.length > 0) {
    catalog.validateGrantableIds(toValidate, deps);
  }

  return capabilityIds;
};

export const resolveAgentTools = <TDeps extends Record<string, unknown>>(
  definition: RuntimeAgentDefinition,
  catalog: CapabilityCatalog,
  deps: TDeps,
  options: {
    includeReadSkill?: boolean;
    readSkillTool?: StructuredToolInterface;
  } = {},
): StructuredToolInterface[] => {
  const capabilityIds = filterGrantableCapabilityIds(definition, catalog, deps);

  if (capabilityIds.includes("none")) {
    return [];
  }

  const capabilityTools = catalog.resolveTools(capabilityIds, deps);
  const includeReadSkill = options.includeReadSkill ?? true;

  if (!includeReadSkill || !options.readSkillTool) {
    return capabilityTools;
  }

  return dedupeToolsByName([options.readSkillTool, ...capabilityTools]);
};
