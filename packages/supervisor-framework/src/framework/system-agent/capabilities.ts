import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  createCapabilityCatalog,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "../../capabilities/index.js";
import {
  SYSTEM_CONFIG_CAPABILITY_ID,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
} from "./constants.js";
import { createSystemConfigTools } from "./tools/system-config-tools.js";
import type { SystemConfigDeps, SystemConfigToolsOptions } from "./types.js";

export const SYSTEM_CONFIG_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    id: SYSTEM_CONFIG_CAPABILITY_ID,
    description: "Manage cron jobs, runtime agents, and skill definitions (read and write).",
    requiresConfigurationRepos: true,
    configurable: false,
  },
  {
    id: SYSTEM_CONFIG_READ_CAPABILITY_ID,
    description: "List cron jobs, runtime agents, skills, and available capabilities.",
    requiresConfigurationRepos: true,
    configurable: true,
  },
];

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

export const mergeCapabilityCatalogs = (
  baseProviders: CapabilityProvider<Record<string, unknown>>[],
  includeSystemConfig = true,
): CapabilityCatalog =>
  createCapabilityCatalog([
    ...baseProviders,
    ...(includeSystemConfig ? createSystemConfigCapabilityProviders() : []),
  ]);
