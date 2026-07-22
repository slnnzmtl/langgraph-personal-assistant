import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SkillCatalog } from "../core/skills/catalog.js";
import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import type { CronJobRepository, RuntimeCronService } from "../cron/types.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import {
  createCapabilityCatalog,
  type CapabilityAvailabilityContext,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "../capabilities/index.js";
import { createSystemConfigDomainTools } from "./policies/configuration/tools.js";
import { createFinanceDomainToolsFromSession } from "./policies/finance/tools.js";
import { createObsidianVaultTools } from "./policies/obsidian/tools.js";

export const BUILTIN_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    id: "none",
    description: "Prompt-only agent with no tools.",
    configurable: true,
  },
  {
    id: "obsidian-vault",
    description: "Read, write, search, and send files from the Obsidian vault.",
    requiresVault: true,
    configurable: true,
  },
  {
    id: "finance-domain",
    description: "Execute SQL, fetch Wise transactions, and load expense categories.",
    requiresSupabase: true,
    configurable: true,
  },
  {
    id: "system-config",
    description: "Manage cron jobs, runtime agents, and skill definitions (read and write).",
    requiresConfigurationRepos: true,
    configurable: false,
  },
  {
    id: "system-config-read",
    description: "List cron jobs, runtime agents, skills, and available capabilities.",
    requiresConfigurationRepos: true,
    configurable: true,
  },
];

export type BuiltinCapabilityId = (typeof BUILTIN_CAPABILITY_DESCRIPTORS)[number]["id"];

const BUILTIN_DESCRIPTOR_BY_ID = new Map<string, CapabilityDescriptor>(
  BUILTIN_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

const getBuiltinDescriptor = (id: BuiltinCapabilityId): CapabilityDescriptor => {
  const descriptor = BUILTIN_DESCRIPTOR_BY_ID.get(id);
  if (!descriptor) {
    throw new Error(`Missing builtin capability descriptor: ${id}`);
  }

  return descriptor;
};

export type CapabilityDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
};

export const createCapabilityDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: CapabilityDeps["fileSender"];
    supabaseSession?: CapabilityDeps["supabaseSession"];
    cronTargetAgentIds?: readonly string[];
    cronJobRepository?: CronJobRepository;
    runtimeAgentRepository?: RuntimeAgentRepository;
    runtimeCron?: RuntimeCronService;
    capabilityCatalog?: CapabilityCatalog;
    skillCatalog?: SkillCatalog;
  } = {},
): CapabilityDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
  ...(options.runtimeAgentRepository ? { runtimeAgentRepository: options.runtimeAgentRepository } : {}),
  ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
  ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
  ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
});

const systemConfigOptions = (deps: CapabilityDeps, writeAccess: boolean) => ({
  writeAccess,
  ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
  ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
});

const resolveSystemConfigCapability = (deps: CapabilityDeps, writeAccess: boolean): StructuredToolInterface[] =>
  createSystemConfigDomainTools(deps, systemConfigOptions(deps, writeAccess));

const createBuiltinCapabilityProviders = (): CapabilityProvider<CapabilityDeps>[] => [
  {
    descriptor: getBuiltinDescriptor("none"),
    resolveTools: () => [],
  },
  {
    descriptor: getBuiltinDescriptor("obsidian-vault"),
    resolveTools: (deps) => createObsidianVaultTools(deps.obsidianVaultPath, deps.fileSender),
  },
  {
    descriptor: getBuiltinDescriptor("finance-domain"),
    resolveTools: (deps) => {
      if (!deps.supabaseSession) {
        throw new Error("finance-domain capability requires a configured Supabase session.");
      }

      return createFinanceDomainToolsFromSession(deps.supabaseSession);
    },
  },
  {
    descriptor: getBuiltinDescriptor("system-config"),
    resolveTools: (deps) => resolveSystemConfigCapability(deps, true),
  },
  {
    descriptor: getBuiltinDescriptor("system-config-read"),
    resolveTools: (deps) => resolveSystemConfigCapability(deps, false),
  },
];

export const createDefaultCapabilityCatalog = (): CapabilityCatalog =>
  createCapabilityCatalog(createBuiltinCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[]);

export const toCapabilityAvailabilityContext = (
  deps: CapabilityDeps,
): CapabilityAvailabilityContext => ({
  obsidianVaultPath: deps.obsidianVaultPath,
  supabaseAvailable: deps.supabaseSession !== undefined,
  configurationReposAvailable:
    deps.cronJobRepository !== undefined && deps.runtimeAgentRepository !== undefined,
});

export const getCapabilityCatalog = (deps: CapabilityDeps): CapabilityCatalog =>
  deps.capabilityCatalog ?? createDefaultCapabilityCatalog();

export const listAvailableCapabilities = (
  deps: CapabilityDeps,
): CapabilityDescriptor[] =>
  getCapabilityCatalog(deps).listAvailable(toCapabilityAvailabilityContext(deps));

export const validateCapabilityIds = (
  capabilityIds: readonly string[],
  deps: CapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateIds(capabilityIds, toCapabilityAvailabilityContext(deps));
};

export const validateGrantableCapabilityIds = (
  capabilityIds: readonly string[],
  deps: CapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateGrantableIds(capabilityIds, toCapabilityAvailabilityContext(deps));
};

export const resolveCapabilities = (
  capabilityIds: readonly string[],
  deps: CapabilityDeps,
): StructuredToolInterface[] =>
  getCapabilityCatalog(deps).resolveTools(
    capabilityIds,
    deps,
    toCapabilityAvailabilityContext(deps),
  );

export const formatCapabilityCatalog = (deps: CapabilityDeps): string =>
  getCapabilityCatalog(deps).formatCatalog(toCapabilityAvailabilityContext(deps));

export const formatGrantableCapabilityCatalog = (deps: CapabilityDeps): string =>
  getCapabilityCatalog(deps).formatGrantableCatalog(toCapabilityAvailabilityContext(deps));
