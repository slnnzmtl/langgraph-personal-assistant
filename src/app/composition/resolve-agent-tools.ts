import type { StructuredToolInterface } from "@langchain/core/tools";

import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentCapabilityIds, resolveAgentSkillModule } from "../../core/types/agent.js";
import { createReadSkillTool } from "../../tools/skill-management.js";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";
import { resolveCapabilities } from "../../runtime-agents/builtin-capabilities.js";

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

export const resolveAgentTools = (
  definition: RuntimeAgentDefinition,
  capabilityDeps: CapabilityDeps,
  options: {
    includeReadSkill?: boolean;
    skillCatalog?: Parameters<typeof createReadSkillTool>[2] extends infer T ? T extends { skillCatalog?: infer S } ? S : never : never;
  } = {},
): StructuredToolInterface[] => {
  const capabilityIds = resolveAgentCapabilityIds(definition);

  if (capabilityIds.includes("none")) {
    return [];
  }

  const capabilityTools = resolveCapabilities(capabilityIds, capabilityDeps);
  const includeReadSkill = options.includeReadSkill ?? true;

  if (!includeReadSkill) {
    return capabilityTools;
  }

  const skillModule = resolveAgentSkillModule(definition);
  const readSkill = createReadSkillTool(
    skillModule,
    "xml",
    options.skillCatalog ? { skillCatalog: options.skillCatalog } : {},
  );

  return dedupeToolsByName([readSkill, ...capabilityTools]);
};
