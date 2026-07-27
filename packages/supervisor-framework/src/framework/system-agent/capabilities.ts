import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "../../capabilities/index.js";
import {
  SYSTEM_CONFIG_CAPABILITY_ID,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
  type SystemConfigDeps,
  type SystemConfigToolsOptions,
} from "./definition.js";
import { createCronTools } from "./tools/cron-tools.js";
import { createRuntimeAgentTools } from "./tools/runtime-agent-tools.js";
import { createSkillCrudTools } from "./tools/skill-tools.js";

export const SYSTEM_CONFIG_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    id: SYSTEM_CONFIG_CAPABILITY_ID,
    description: "Manage cron jobs, runtime agents, and skill definitions (read and write).",
    requiresConfigurationRepos: true,
    configurable: false,
  },
  {
    id: SYSTEM_CONFIG_READ_CAPABILITY_ID,
    description: "List cron jobs, runtime agent summaries, skills, and available capabilities (no full agent prompts).",
    requiresConfigurationRepos: true,
    configurable: true,
  },
];

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

const resolveSystemConfigTools = (
  deps: SystemConfigDeps,
  writeAccess: boolean,
  options: SystemConfigToolsOptions = {},
): StructuredToolInterface[] =>
  createSystemConfigTools(deps, { ...options, writeAccess });

export const createSystemConfigCapabilityProviders = <
  TDeps extends SystemConfigDeps,
>(): CapabilityProvider<TDeps>[] => [
  {
    descriptor: SYSTEM_CONFIG_CAPABILITY_DESCRIPTORS[0]!,
    resolveTools: (deps) => resolveSystemConfigTools(deps, true, {
      ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
      ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
      ...(deps.cronTargetAgentIds ? { cronTargetAgentIds: deps.cronTargetAgentIds } : {}),
    }),
  },
  {
    descriptor: SYSTEM_CONFIG_CAPABILITY_DESCRIPTORS[1]!,
    resolveTools: (deps) => resolveSystemConfigTools(deps, false, {
      ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
      ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
      ...(deps.cronTargetAgentIds ? { cronTargetAgentIds: deps.cronTargetAgentIds } : {}),
    }),
  },
];
