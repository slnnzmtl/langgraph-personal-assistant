import type { StructuredToolInterface } from "@langchain/core/tools";

import type { CapabilityCatalog } from "../capabilities/index.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import { resolveAgentCapabilityIds } from "../core/types/agent.js";

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

export const resolveAgentTools = <TDeps extends Record<string, unknown>>(
  definition: RuntimeAgentDefinition,
  catalog: CapabilityCatalog,
  deps: TDeps,
  options: {
    includeReadSkill?: boolean;
    readSkillTool?: StructuredToolInterface;
  } = {},
): StructuredToolInterface[] => {
  const capabilityIds = resolveAgentCapabilityIds(definition);

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
