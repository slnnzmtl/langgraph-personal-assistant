import type { StructuredToolInterface } from "@langchain/core/tools";

import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentCapabilityIds, resolveAgentSkillModule } from "../../core/types/agent.js";
import { createReadSkillTool } from "../../tools/skill-management.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { resolveRuntimeToolBundles } from "../../runtime-agents/tool-bundles.js";

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

export const resolveAgentCapabilityTools = (
  definition: RuntimeAgentDefinition,
  bundleDeps: RuntimeToolBundleDeps,
  options: {
    includeReadSkill?: boolean;
    skillCatalog?: Parameters<typeof createReadSkillTool>[2] extends infer T ? T extends { skillCatalog?: infer S } ? S : never : never;
  } = {},
): StructuredToolInterface[] => {
  const capabilityIds = resolveAgentCapabilityIds(definition);
  const bundleTools = resolveRuntimeToolBundles(capabilityIds, bundleDeps);
  const includeReadSkill = options.includeReadSkill ?? true;

  if (!includeReadSkill || capabilityIds.includes("none")) {
    return bundleTools;
  }

  const skillModule = resolveAgentSkillModule(definition);
  const readSkill = createReadSkillTool(
    skillModule,
    "xml",
    options.skillCatalog ? { skillCatalog: options.skillCatalog } : {},
  );

  return dedupeToolsByName([readSkill, ...bundleTools]);
};
