import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  createReadSkillTool,
  resolveAgentSkillModule,
  resolveAgentTools,
  type CapabilityCatalog,
  type RuntimeAgentDefinition,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityDeps } from "../runtime-agents/builtin-capabilities.js";
import { toCapabilityAvailabilityContext } from "../runtime-agents/builtin-capabilities.js";

export type PersonalResolveToolsOptions = {
  includeReadSkill?: boolean;
  skillCatalog?: SkillCatalog;
};

export type PersonalResolveTools = (
  definition: RuntimeAgentDefinition,
  capabilityDeps: CapabilityDeps,
  options?: PersonalResolveToolsOptions,
) => StructuredToolInterface[];

export const createPersonalResolveTools = (catalog: CapabilityCatalog): PersonalResolveTools =>
  (definition, capabilityDeps, options = {}) => {
    const includeReadSkill = options.includeReadSkill ?? true;
    const readSkillTool = includeReadSkill
      ? createReadSkillTool(
          resolveAgentSkillModule(definition),
          "xml",
          options.skillCatalog ? { skillCatalog: options.skillCatalog } : {},
        )
      : undefined;

    return resolveAgentTools(
      definition,
      catalog,
      capabilityDeps,
      toCapabilityAvailabilityContext(capabilityDeps),
      includeReadSkill && readSkillTool
        ? { includeReadSkill, readSkillTool }
        : { includeReadSkill },
    );
  };
