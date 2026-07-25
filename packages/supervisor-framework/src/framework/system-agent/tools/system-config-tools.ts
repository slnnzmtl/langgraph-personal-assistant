import type { StructuredToolInterface } from "@langchain/core/tools";

import { createCronTools } from "./cron-tools.js";
import { createRuntimeAgentTools } from "./runtime-agent-tools.js";
import { createSkillCrudTools } from "./skill-tools.js";
import type { SystemConfigDeps, SystemConfigToolsOptions } from "../types.js";

export const createSystemConfigTools = (
  deps: SystemConfigDeps,
  options: SystemConfigToolsOptions = {},
): StructuredToolInterface[] => {
  if (!deps.cronJobRepository || !deps.runtimeAgentRepository) {
    throw new Error("system-config capability requires cron and runtime agent repositories.");
  }

  const writeAccess = options.writeAccess ?? true;
  const capabilityCatalog = options.capabilityCatalog ?? deps.capabilityCatalog;
  const skillCatalog = options.skillCatalog ?? deps.skillCatalog;
  const cronTools = createCronTools(deps.cronJobRepository, {
    writeAccess,
    cronTargetAgentIds: options.cronTargetAgentIds ?? deps.cronTargetAgentIds ?? [],
    ...(options.validateCronTargetRoute ? { validateCronTargetRoute: options.validateCronTargetRoute } : {}),
  });

  const runtimeAgentTools = createRuntimeAgentTools(deps.runtimeAgentRepository, deps, {
    writeAccess,
    ...(capabilityCatalog ? { capabilityCatalog } : {}),
  });

  const skillManagementTools = skillCatalog
    ? createSkillCrudTools({ skillCatalog, writeAccess })
    : [];

  return [...cronTools, ...skillManagementTools, ...runtimeAgentTools];
};
