import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SkillCatalog } from "../core/skills/catalog.js";
import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import type { CronJobRepository } from "../cron/types.js";
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
  {
    id: "system-config-write",
    description: "Create, update, and delete cron jobs, runtime agents, and skills.",
    requiresConfigurationRepos: true,
    configurable: false,
  },
];

export type RuntimeToolBundleId = (typeof BUILTIN_CAPABILITY_DESCRIPTORS)[number]["id"];

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
};

export const createRuntimeToolBundleDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: RuntimeToolBundleDeps["fileSender"];
    supabaseSession?: RuntimeToolBundleDeps["supabaseSession"];
    cronTargetAgentIds?: readonly string[];
    cronJobRepository?: CronJobRepository;
    runtimeAgentRepository?: RuntimeAgentRepository;
    capabilityCatalog?: CapabilityCatalog;
    skillCatalog?: SkillCatalog;
  } = {},
): RuntimeToolBundleDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
  ...(options.runtimeAgentRepository ? { runtimeAgentRepository: options.runtimeAgentRepository } : {}),
  ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
  ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
});

const systemConfigOptions = (deps: RuntimeToolBundleDeps, writeAccess: boolean) => ({
  writeAccess,
  ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
  ...(deps.capabilityCatalog ? { capabilityCatalog: deps.capabilityCatalog } : {}),
});

const createBuiltinCapabilityProviders = (): CapabilityProvider<RuntimeToolBundleDeps>[] => [
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[0]!,
    resolveTools: () => [],
  },
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[1]!,
    resolveTools: (deps) => createObsidianVaultTools(deps.obsidianVaultPath, deps.fileSender),
  },
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[2]!,
    resolveTools: (deps) => {
      if (!deps.supabaseSession) {
        throw new Error("finance-domain capability requires a configured Supabase session.");
      }

      return createFinanceDomainToolsFromSession(deps.supabaseSession);
    },
  },
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[3]!,
    resolveTools: (deps) => createSystemConfigDomainTools(deps, systemConfigOptions(deps, true)),
  },
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[4]!,
    resolveTools: (deps) => createSystemConfigDomainTools(deps, systemConfigOptions(deps, false)),
  },
  {
    descriptor: BUILTIN_CAPABILITY_DESCRIPTORS[5]!,
    resolveTools: (deps) => createSystemConfigDomainTools(deps, systemConfigOptions(deps, true)),
  },
];

export const createDefaultCapabilityCatalog = (): CapabilityCatalog =>
  createCapabilityCatalog(createBuiltinCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[]);

export const toCapabilityAvailabilityContext = (
  deps: RuntimeToolBundleDeps,
): CapabilityAvailabilityContext => ({
  obsidianVaultPath: deps.obsidianVaultPath,
  supabaseAvailable: deps.supabaseSession !== undefined,
  configurationReposAvailable:
    deps.cronJobRepository !== undefined && deps.runtimeAgentRepository !== undefined,
});

export const getCapabilityCatalog = (deps: RuntimeToolBundleDeps): CapabilityCatalog =>
  deps.capabilityCatalog ?? createDefaultCapabilityCatalog();

export const listAvailableRuntimeToolBundles = (
  deps: RuntimeToolBundleDeps,
): CapabilityDescriptor[] =>
  getCapabilityCatalog(deps).listAvailable(toCapabilityAvailabilityContext(deps));

export const validateRuntimeToolBundleIds = (
  bundleIds: readonly string[],
  deps: RuntimeToolBundleDeps,
): void => {
  getCapabilityCatalog(deps).validateIds(bundleIds, toCapabilityAvailabilityContext(deps));
};

export const resolveRuntimeToolBundles = (
  bundleIds: readonly string[],
  deps: RuntimeToolBundleDeps,
): StructuredToolInterface[] =>
  getCapabilityCatalog(deps).resolveTools(
    bundleIds,
    deps,
    toCapabilityAvailabilityContext(deps),
  );

export const formatRuntimeToolBundleCatalog = (deps: RuntimeToolBundleDeps): string =>
  getCapabilityCatalog(deps).formatCatalog(toCapabilityAvailabilityContext(deps));

/** @deprecated Use BUILTIN_CAPABILITY_DESCRIPTORS */
export const RUNTIME_TOOL_BUNDLE_CATALOG = BUILTIN_CAPABILITY_DESCRIPTORS;

/** @deprecated Use createDefaultCapabilityCatalog().createIdSchema() */
export { createDefaultCapabilityCatalog as createRuntimeToolBundleIdSchemaSource };

/** @deprecated Use BUILTIN_CAPABILITY_DESCRIPTORS ids */
export const RUNTIME_TOOL_BUNDLE_IDS = BUILTIN_CAPABILITY_DESCRIPTORS.map(
  (entry) => entry.id,
) as unknown as readonly RuntimeToolBundleId[];

export type RuntimeToolBundleCatalogEntry = CapabilityDescriptor;
